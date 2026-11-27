import { createHash, randomUUID } from 'node:crypto';

import { authSchema, persistenceSchema, vaultSchema, type Database } from '@visomi-stack/backend-db';
import { parseProductPolicy, type PersistenceAction, type ProductPolicy } from '@visomi-stack/shared-db';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, asc, desc, eq, exists, gt, inArray, isNull, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import { lockIdentity, requireFull, type Principal, type Transaction } from '../auth/shared/identity';

import { grantInputSchema, memberInputSchema, scopeInputSchema, targetSchema, type AccessTarget } from './contracts';

const { tenants, scopes, memberships, grants } = persistenceSchema;
const { keyChallenges, keyScopes, opaqueUnits } = vaultSchema;

function vaultRegistry(tx: Transaction) {
  // Bootstrap commits the first device and its registry in one transaction.
  return tx
    .select({ scopeId: keyScopes.scopeId })
    .from(keyScopes)
    .where(
      and(
        eq(keyScopes.tenantId, scopes.tenantId),
        eq(keyScopes.scopeId, scopes.id),
        eq(keyScopes.domain, 'private-resources'),
      ),
    );
}

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

      return this.insertTenant(tx, actor.principal.id);
    });
  }

  async startExampleVault(actor: SessionActor, additional = false) {
    return this.database.transaction(async (tx) => {
      // The account row lock is shared by setup and bootstrap, including requests from other sessions.
      await this.identity(tx, actor);

      const [pending] = await this.pendingVault(tx, actor.principal.id);

      if (pending) {
        return pending;
      }

      const [enrolled] = await this.exampleWorkspaces(tx, actor.principal.id, true).limit(1);

      if (enrolled && !additional) {
        return null;
      }

      const { tenantId } = await this.insertTenant(tx, actor.principal.id);
      const scopeId = randomUUID();

      await tx
        .insert(scopes)
        .values({ id: scopeId, tenantId, parentId: tenantId, kind: 'resource', objectBackup: true });

      return { tenantId, scopeId };
    });
  }

  async listExampleWorkspaces(
    actor: SessionActor,
    objectBackup: boolean,
    { after, limit }: { after?: string; limit: number },
  ) {
    return this.database.transaction(async (tx) => {
      await this.identity(tx, actor);

      const rows = await this.exampleWorkspaces(tx, actor.principal.id, objectBackup, after).limit(limit + 1);
      const page = rows.slice(0, limit);
      const pending = await (objectBackup ? this.pendingVault(tx, actor.principal.id) : []);

      return {
        items: page.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
        next: rows.length > limit ? page.at(-1)!.scopeId : null,
        ...(objectBackup && { pendingSetup: pending.length > 0 }),
      };
    });
  }

  async listExampleVaultPairings(actor: SessionActor) {
    return this.database.transaction(async (tx) => {
      await this.identity(tx, actor);

      const workspaces = this.exampleWorkspaces(tx, actor.principal.id, true).as('pairing_workspaces');

      return tx
        .select({
          tenantId: keyChallenges.tenantId,
          scopeId: keyChallenges.scopeId,
          objectId: sql<string>`coalesce(${workspaces.objectId!}, ${keyChallenges.scopeId})`,
          requestId: keyChallenges.id,
        })
        .from(keyChallenges)
        .innerJoin(
          workspaces,
          and(eq(workspaces.tenantId, keyChallenges.tenantId), eq(workspaces.scopeId, keyChallenges.scopeId)),
        )
        .innerJoin(
          keyScopes,
          and(
            eq(keyScopes.tenantId, keyChallenges.tenantId),
            eq(keyScopes.scopeId, keyChallenges.scopeId),
            eq(keyScopes.domain, keyChallenges.domain),
          ),
        )
        .where(
          and(
            eq(keyChallenges.ownerId, actor.principal.id),
            eq(workspaces.owner, true),
            eq(workspaces.deletingBackup!, false),
            eq(keyChallenges.domain, 'private-resources'),
            eq(keyScopes.phase, 'ready'),
            isNull(keyChallenges.consumedAt),
            gt(keyChallenges.expiresAt, new Date()),
            sql`${keyChallenges.value} ? 'proof'`,
            sql`${keyChallenges.value}->'key'->>'generation' = ${keyScopes.generation}::text`,
          ),
        )
        .orderBy(desc(keyChallenges.expiresAt), asc(keyChallenges.id))
        .limit(32);
    });
  }

  async withScope<T>(
    actor: SessionActor,
    rawTarget: unknown,
    action: PersistenceAction,
    work: (access: ScopeAccess) => Promise<T>,
    deletingBackup = false,
  ) {
    const target = input(targetSchema, rawTarget);

    return this.withTenant(actor, target.tenantId, async (tx, tenant) => {
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

      if (scope.deletingBackup && !deletingBackup) {
        throw new HttpError(409, 'vault_deletion_pending');
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

  /** Serializes changes to an authenticated tenant. Callers must establish scope authority before granting access. */
  async withTenant<T>(
    actor: SessionActor,
    tenantId: string,
    work: (tx: Transaction, tenant: typeof tenants.$inferSelect) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (tx) => {
      await this.identity(tx, actor);

      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update');

      if (!tenant || tenant.product !== this.policy.product) {
        throw new HttpError(403, 'scope_access_denied');
      }

      if (tenant.policyHash !== this.policyHash) {
        throw new HttpError(409, 'policy_migration_required');
      }

      return work(tx, tenant);
    });
  }

  async createScope(actor: SessionActor, target: unknown, raw: unknown, objectBackup = false) {
    const value = input(scopeInputSchema, raw);

    return this.withScope(actor, target, 'share', async ({ tx, scope }) => {
      if (scope.kind === 'resource' || (value.kind === 'group' && scope.kind !== 'tenant')) {
        throw new HttpError(400, 'scope_parent_invalid');
      }

      const id = randomUUID();

      await tx
        .insert(scopes)
        .values({ id, tenantId: scope.tenantId, parentId: scope.id, kind: value.kind, objectBackup });

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

  private async insertTenant(tx: Transaction, userId: string) {
    const id = randomUUID();

    await tx.insert(tenants).values({ id, product: this.manifest.product, policyHash: this.policyHash });

    await tx.insert(scopes).values({ id, tenantId: id, kind: 'tenant' });

    await tx.insert(memberships).values({ tenantId: id, userId, owner: true });

    return { tenantId: id, scopeId: id };
  }

  private pendingVault(tx: Transaction, userId: string) {
    return tx
      .select({ tenantId: tenants.id, scopeId: scopes.id })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .innerJoin(scopes, and(eq(scopes.tenantId, tenants.id), eq(scopes.parentId, tenants.id)))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.owner, true),
          isNull(memberships.revokedAt),
          eq(tenants.product, this.manifest.product),
          eq(tenants.policyHash, this.policyHash),
          eq(scopes.kind, 'resource'),
          eq(scopes.objectBackup, true),
          eq(scopes.deletingBackup, false),
          notExists(vaultRegistry(tx)),
        ),
      )
      .orderBy(desc(tenants.createdAt), asc(scopes.id))
      .limit(1);
  }

  private exampleWorkspaces(tx: Transaction, userId: string, objectBackup: boolean, after?: string) {
    const directGrant = alias(grants, 'workspace_grant');
    const rootGrant = alias(grants, 'workspace_root_grant');
    const objectId = sql<string | null>`(
      select ${opaqueUnits.id} from ${opaqueUnits}
      where ${opaqueUnits.tenantId} = ${scopes.tenantId}
        and ${opaqueUnits.scopeId} = ${scopes.id}
        and ${opaqueUnits.domain} = 'private-resources'
        and not ${opaqueUnits.tombstone}
      order by ${opaqueUnits.cursor} desc
      limit 1
    )`.as('object_id');
    const readable = Object.entries(actions)
      .filter(([, allowed]) => allowed.includes('read'))
      .map(([role]) => role);

    // Both example products create direct resource children. The nearer grant has precedence.
    return tx
      .select({
        tenantId: sql<string>`${tenants.id}`.as('workspace_tenant_id'),
        scopeId: sql<string>`${scopes.id}`.as('workspace_scope_id'),
        createdAt: tenants.createdAt,
        owner: memberships.owner,
        ...(objectBackup ? { objectId, deletingBackup: scopes.deletingBackup } : {}),
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .innerJoin(scopes, and(eq(scopes.tenantId, tenants.id), eq(scopes.parentId, tenants.id)))
      .leftJoin(
        directGrant,
        and(
          eq(directGrant.tenantId, tenants.id),
          eq(directGrant.scopeId, scopes.id),
          eq(directGrant.userId, memberships.userId),
        ),
      )
      .leftJoin(
        rootGrant,
        and(
          eq(rootGrant.tenantId, tenants.id),
          eq(rootGrant.scopeId, tenants.id),
          eq(rootGrant.userId, memberships.userId),
        ),
      )
      .where(
        and(
          eq(memberships.userId, userId),
          isNull(memberships.revokedAt),
          eq(tenants.product, this.manifest.product),
          eq(tenants.policyHash, this.policyHash),
          eq(scopes.kind, 'resource'),
          eq(scopes.objectBackup, objectBackup),
          or(eq(memberships.owner, true), inArray(sql`coalesce(${directGrant.role}, ${rootGrant.role})`, readable)),
          objectBackup ? exists(vaultRegistry(tx)) : undefined,
          after ? gt(scopes.id, after) : undefined,
        ),
      )
      .orderBy(asc(scopes.id));
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
