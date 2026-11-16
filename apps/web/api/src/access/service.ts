import { createHash, randomUUID } from 'node:crypto';

import { authSchema, persistenceSchema, vaultSchema, type Database } from '@visomi-stack/backend-shared';
import { parseProductPolicy, type PersistenceAction, type ProductPolicy } from '@visomi-stack/shared-persistence';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { lockIdentity, requireFull, type Principal, type Transaction } from '../auth/shared/identity';

import { grantInputSchema, memberInputSchema, scopeInputSchema, targetSchema, type AccessTarget } from './contracts';

const { tenants, scopes, memberships, grants } = persistenceSchema;

export type SessionActor = { sessionId: string; principal: Principal };
export type ScopeAccess = {
  tx: Transaction;
  actor: SessionActor;
  target: AccessTarget;
  tenant: typeof tenants.$inferSelect;
  scope: typeof scopes.$inferSelect;
  ancestry: readonly (typeof scopes.$inferSelect)[];
  membership: typeof memberships.$inferSelect;
  actions: readonly PersistenceAction[];
};

export function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new HttpError(400, 'request_invalid');
  }

  return result.data;
}

const actions: Record<string, readonly PersistenceAction[]> = {
  viewer: ['read'],
  editor: ['read', 'write', 'delete'],
  manager: ['read', 'write', 'share', 'delete'],
  blocked: [],
};

/** All authority checks and work share the caller's transaction and tenant lock. */
export class Access {
  private readonly manifest: ProductPolicy;
  private readonly policyHash: string;

  constructor(
    private readonly database: Database,
    policy: ProductPolicy,
  ) {
    this.manifest = parseProductPolicy(policy);
    this.policyHash = createHash('sha256').update(JSON.stringify(this.manifest)).digest('hex');
  }

  get policy(): ProductPolicy {
    return parseProductPolicy(this.manifest);
  }

  async createTenant(actor: SessionActor) {
    return this.database.transaction(async (tx) => {
      await this.identity(tx, actor);

      const id = randomUUID();

      await tx.insert(tenants).values({ id, product: this.policy.product, policyHash: this.policyHash });

      await tx.insert(scopes).values({ id, tenantId: id, kind: 'tenant' });

      await tx.insert(memberships).values({ tenantId: id, userId: actor.principal.id, owner: true });

      return { tenantId: id, scopeId: id };
    });
  }

  async withScope<T>(
    actor: SessionActor,
    rawTarget: unknown,
    action: PersistenceAction,
    work: (access: ScopeAccess) => Promise<T>,
  ) {
    const target = input(targetSchema, rawTarget);

    return this.database.transaction(async (tx) => {
      await this.identity(tx, actor);

      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, target.tenantId)).for('update');

      if (!tenant || tenant.product !== this.policy.product) {
        throw new HttpError(403, 'scope_access_denied');
      }

      if (tenant.policyHash !== this.policyHash) {
        throw new HttpError(409, 'policy_migration_required');
      }

      const [membership] = await tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, target.tenantId),
            eq(memberships.userId, actor.principal.id),
            isNull(memberships.revokedAt),
          ),
        );

      if (!membership) {
        throw new HttpError(403, 'scope_access_denied');
      }

      const ancestry: (typeof scopes.$inferSelect)[] = [];
      let scopeId: string | null = target.scopeId;

      for (let depth = 0; scopeId && depth < 3; depth++) {
        const [scope] = await tx
          .select()
          .from(scopes)
          .where(and(eq(scopes.tenantId, target.tenantId), eq(scopes.id, scopeId)));

        if (!scope || ancestry.some((entry) => entry.id === scope.id)) {
          throw new HttpError(403, 'scope_access_denied');
        }

        ancestry.push(scope);
        scopeId = scope.parentId;
      }

      const root = ancestry.at(-1);
      const scope = ancestry[0];
      const kinds = ancestry.map((entry) => entry.kind).join('/');

      if (
        !scope ||
        !root ||
        root.id !== target.tenantId ||
        !['tenant', 'group/tenant', 'resource/tenant', 'resource/group/tenant'].includes(kinds)
      ) {
        throw new HttpError(403, 'scope_access_denied');
      }

      let allowedActions: readonly PersistenceAction[] = ['read', 'write', 'share', 'delete'];

      if (!membership.owner) {
        const assigned = await tx
          .select()
          .from(grants)
          .where(
            and(
              eq(grants.tenantId, target.tenantId),
              eq(grants.userId, actor.principal.id),
              inArray(
                grants.scopeId,
                ancestry.map((entry) => entry.id),
              ),
            ),
          );
        const grant = ancestry.map((entry) => assigned.find((row) => row.scopeId === entry.id)).find(Boolean);

        if (!grant || !actions[grant.role]?.includes(action)) {
          throw new HttpError(403, 'scope_access_denied');
        }

        allowedActions = actions[grant.role];
      }

      return work({ tx, actor, target, tenant, scope, ancestry, membership, actions: allowedActions });
    });
  }

  async createScope(actor: SessionActor, target: unknown, raw: unknown) {
    const value = input(scopeInputSchema, raw);

    return this.withScope(actor, target, 'share', async ({ tx, scope }) => {
      if (scope.kind === 'resource' || (value.kind === 'group' && scope.kind !== 'tenant')) {
        throw new HttpError(400, 'scope_parent_invalid');
      }

      const id = randomUUID();

      await tx.insert(scopes).values({ id, tenantId: scope.tenantId, parentId: scope.id, kind: value.kind });

      return { tenantId: scope.tenantId, scopeId: id };
    });
  }

  async requireRecipient(context: ScopeAccess, userId: string) {
    const [member] = await context.tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, context.target.tenantId),
          eq(memberships.userId, userId),
          isNull(memberships.revokedAt),
        ),
      );

    if (!member) {
      throw new HttpError(403, 'scope_access_denied');
    }

    if (member.owner) {
      return;
    }

    const assigned = await context.tx
      .select()
      .from(grants)
      .where(
        and(
          eq(grants.tenantId, context.target.tenantId),
          eq(grants.userId, userId),
          inArray(
            grants.scopeId,
            context.ancestry.map((entry) => entry.id),
          ),
        ),
      );
    const grant = context.ancestry.map((entry) => assigned.find((row) => row.scopeId === entry.id)).find(Boolean);

    if (!grant || !actions[grant.role]?.includes('read')) {
      throw new HttpError(403, 'scope_access_denied');
    }
  }

  async setMember(actor: SessionActor, target: unknown, raw: unknown) {
    const value = input(memberInputSchema, raw);

    return this.withScope(actor, target, 'share', async ({ tx, scope, membership }) => {
      if (scope.kind !== 'tenant' || !membership.owner) {
        throw new HttpError(403, 'scope_access_denied');
      }

      const [existing] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.tenantId, scope.tenantId), eq(memberships.userId, value.userId)));
      const [user] = await tx
        .select({ verified: authSchema.users.emailVerifiedAt })
        .from(authSchema.users)
        .where(eq(authSchema.users.id, value.userId));

      if (existing?.owner) {
        throw new HttpError(409, 'ownership_transfer_required');
      }

      if (!user?.verified) {
        throw new HttpError(400, 'member_unavailable');
      }

      const revokedAt = value.active ? null : new Date();

      await tx
        .insert(memberships)
        .values({ tenantId: scope.tenantId, userId: value.userId, revokedAt })
        .onConflictDoUpdate({ target: [memberships.tenantId, memberships.userId], set: { revokedAt } });

      // Rejoining does not resurrect grants from an earlier membership.
      await tx.delete(grants).where(and(eq(grants.tenantId, scope.tenantId), eq(grants.userId, value.userId)));

      await this.revokeKeyDevices(tx, scope.tenantId, value.userId);

      await tx
        .update(tenants)
        .set({ epoch: sql`${tenants.epoch} + 1` })
        .where(eq(tenants.id, scope.tenantId));

      return { changed: true };
    });
  }

  async setGrant(actor: SessionActor, target: unknown, raw: unknown) {
    const value = input(grantInputSchema, raw);

    return this.withScope(actor, target, 'share', async ({ tx, scope, actor: current }) => {
      const [member] = await tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, scope.tenantId),
            eq(memberships.userId, value.userId),
            isNull(memberships.revokedAt),
          ),
        );

      if (!member || member.owner || value.userId === current.principal.id) {
        throw new HttpError(403, 'scope_access_denied');
      }

      const [previous] = await tx
        .select({ role: grants.role })
        .from(grants)
        .where(and(eq(grants.tenantId, scope.tenantId), eq(grants.scopeId, scope.id), eq(grants.userId, value.userId)));

      if (previous?.role !== value.role) {
        await this.revokeKeyDevices(tx, scope.tenantId, value.userId);
      }

      await tx
        .insert(grants)
        .values({ tenantId: scope.tenantId, scopeId: scope.id, userId: value.userId, role: value.role })
        .onConflictDoUpdate({ target: [grants.tenantId, grants.scopeId, grants.userId], set: { role: value.role } });

      await tx
        .update(tenants)
        .set({ epoch: sql`${tenants.epoch} + 1` })
        .where(eq(tenants.id, scope.tenantId));

      return { changed: true };
    });
  }

  private async identity(tx: Transaction, actor: SessionActor) {
    const principal = requireFull(actor.principal);
    const user = await lockIdentity(tx, actor.sessionId, principal);
    const [session] = await tx
      .select({ value: authSchema.sessions.sess })
      .from(authSchema.sessions)
      .where(eq(authSchema.sessions.sid, actor.sessionId));
    const stored = session?.value as { passport?: { user?: { id?: string; version?: number } } } | undefined;

    if (
      !user.emailVerifiedAt ||
      stored?.passport?.user?.id !== principal.id ||
      stored.passport.user.version !== principal.version
    ) {
      throw new HttpError(401, 'authentication_required');
    }
  }

  private async revokeKeyDevices(tx: Transaction, tenantId: string, userId: string) {
    // Conservative across the tenant: changed authority requires explicit reapproval and a fresh generation.
    const { keyDevices, keyScopes } = vaultSchema;
    const revoked = await tx
      .update(keyDevices)
      .set({ revokedAt: new Date(), delivery: null })
      .where(and(eq(keyDevices.tenantId, tenantId), eq(keyDevices.ownerId, userId), isNull(keyDevices.revokedAt)))
      .returning({ scopeId: keyDevices.scopeId, domain: keyDevices.domain });

    for (const key of revoked) {
      await tx
        .update(keyScopes)
        .set({ phase: 'rotating', epoch: sql`${keyScopes.epoch} + 1` })
        .where(
          and(eq(keyScopes.tenantId, tenantId), eq(keyScopes.scopeId, key.scopeId), eq(keyScopes.domain, key.domain)),
        );
    }
  }
}
