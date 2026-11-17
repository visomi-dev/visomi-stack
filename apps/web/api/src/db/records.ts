import { createHash, randomUUID } from 'node:crypto';

import { persistenceSchema } from '@visomi-stack/backend-db';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { operationIdSchema, type DomainPolicy } from '@visomi-stack/shared-db';
import { and, asc, eq, gt, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { Access, input, type ScopeAccess, type SessionActor } from '../access/service';

import { requireCurrentOperation } from './operation-time';

const { records, commands } = persistenceSchema;
const content = {
  title: z.string().trim().min(1).max(160),
  body: z.string().max(16_384),
  audience: z.enum(['owner', 'scope']),
};

export const recordMutationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), operationId: operationIdSchema, ...content }),
  z.strictObject({
    kind: z.literal('update'),
    operationId: operationIdSchema,
    id: z.uuid(),
    expectedRevision: z.number().int().positive().max(2_147_483_646),
    ...content,
  }),
  z.strictObject({
    kind: z.literal('delete'),
    operationId: operationIdSchema,
    id: z.uuid(),
    expectedRevision: z.number().int().positive().max(2_147_483_646),
  }),
]);
export const pageSchema = z.strictObject({
  after: z.uuid().optional(),
  limit: z.number().int().min(1).max(100),
  search: z.string().min(1).max(100).optional(),
});
const publicRecord = {
  id: records.id,
  title: records.title,
  body: records.body,
  audience: records.audience,
  revision: records.revision,
};

/** Server-readable adapter. It never accepts ciphertext-only domain policies. */
export class SaasRecords {
  constructor(private readonly access: Access) {}

  async list(actor: SessionActor, target: unknown, domain: string, rawPage: unknown) {
    const page = input(pageSchema, rawPage);
    const policy = this.domain(domain);

    if (page.search !== undefined && !policy.serverProcessing.search) {
      throw new HttpError(409, 'capability_unavailable');
    }

    return this.access.withScope(actor, target, 'read', async (context) => {
      this.scope(context, policy);
      const search = page.search?.replace(/[\\%_]/g, '\\$&');
      const items = await context.tx
        .select(publicRecord)
        .from(records)
        .where(
          and(
            this.predicate(context, policy),
            isNull(records.deletedAt),
            this.retention(policy),
            page.after ? gt(records.id, page.after) : undefined,
            search ? ilike(records.title, `%${search}%`) : undefined,
          ),
        )
        .orderBy(asc(records.id))
        .limit(page.limit + 1);
      const more = items.length > page.limit;

      return { items: items.slice(0, page.limit), next: more ? items[page.limit - 1].id : null };
    });
  }

  async read(actor: SessionActor, target: unknown, domain: string, rawId: unknown) {
    const id = input(z.uuid(), rawId);
    const policy = this.domain(domain);

    return this.access.withScope(actor, target, 'read', async (context) => {
      this.scope(context, policy);
      const [record] = await context.tx
        .select(publicRecord)
        .from(records)
        .where(
          and(this.predicate(context, policy), eq(records.id, id), isNull(records.deletedAt), this.retention(policy)),
        );

      if (!record) {
        throw new HttpError(404, 'record_unavailable');
      }

      return record;
    });
  }

  async mutate(actor: SessionActor, target: unknown, domain: string, raw: unknown) {
    const value = input(recordMutationSchema, raw);
    const policy = this.domain(domain);
    const bytes = Buffer.byteLength(JSON.stringify(value));

    if (bytes > policy.quotas.maxUnitBytes) {
      throw new HttpError(413, 'quota_exceeded');
    }

    return this.access.withScope(actor, target, value.kind === 'delete' ? 'delete' : 'write', async (context) => {
      this.scope(context, policy);
      const { tx } = context;

      requireCurrentOperation(value.operationId, policy);
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([domain, value]))
        .digest('hex');
      const commandPredicate = and(
        eq(commands.tenantId, context.target.tenantId),
        eq(commands.scopeId, context.scope.id),
        eq(commands.userId, actor.principal.id),
        eq(commands.operationId, value.operationId),
      );
      const [previous] = await tx.select().from(commands).where(commandPredicate);

      if (previous) {
        if (previous.fingerprint !== fingerprint) {
          throw new HttpError(409, 'idempotency_conflict');
        }

        const [current] = await tx
          .select({ id: records.id })
          .from(records)
          .where(and(this.predicate(context, policy), eq(records.id, previous.result.id)));

        if (!current) {
          throw new HttpError(404, 'record_unavailable');
        }

        return previous.result;
      }

      let result: { id: string; revision: number; deleted: boolean };

      if (value.kind === 'create') {
        this.sharing(context, value.audience === 'scope');
        const id = randomUUID();

        await this.quota(context, policy, value.title, value.body);

        await tx.insert(records).values({
          id,
          tenantId: context.target.tenantId,
          scopeId: context.scope.id,
          domain,
          ownerId: actor.principal.id,
          title: value.title,
          body: value.body,
          audience: value.audience,
          revision: 1,
        });

        result = { id, revision: 1, deleted: false };
      } else {
        const [current] = await tx
          .select()
          .from(records)
          .where(
            and(
              this.predicate(context, policy),
              eq(records.id, value.id),
              isNull(records.deletedAt),
              this.retention(policy),
            ),
          );

        if (!current) {
          throw new HttpError(404, 'record_unavailable');
        }

        if (current.revision !== value.expectedRevision) {
          throw new HttpError(409, 'revision_conflict');
        }

        if (value.kind === 'update') {
          this.sharing(context, current.audience !== value.audience);

          await this.quota(context, policy, value.title, value.body, current);
        }

        await tx
          .update(records)
          .set({
            title: value.kind === 'delete' ? '' : value.title,
            body: value.kind === 'delete' ? '' : value.body,
            audience: value.kind === 'delete' ? current.audience : value.audience,
            deletedAt: value.kind === 'delete' ? new Date() : null,
            updatedAt: new Date(),
            revision: value.expectedRevision + 1,
          })
          .where(
            and(
              eq(records.tenantId, context.target.tenantId),
              eq(records.id, value.id),
              eq(records.revision, value.expectedRevision),
            ),
          );

        result = { id: value.id, revision: value.expectedRevision + 1, deleted: value.kind === 'delete' };
      }

      await tx.insert(commands).values({
        tenantId: context.target.tenantId,
        scopeId: context.scope.id,
        domain,
        userId: actor.principal.id,
        operationId: value.operationId,
        fingerprint,
        result,
      });

      return result;
    });
  }

  private domain(name: string): DomainPolicy {
    const policy = this.access.policy.domains.find((entry) => entry.domain === name);

    if (!policy || policy.readers !== 'server-authorized') {
      throw new HttpError(409, 'domain_adapter_incompatible');
    }

    return policy;
  }

  private scope(context: ScopeAccess, policy: DomainPolicy) {
    if (context.scope.kind !== policy.authorization.scope) {
      throw new HttpError(403, 'scope_access_denied');
    }
  }

  private predicate(context: ScopeAccess, policy: DomainPolicy) {
    return and(
      eq(records.tenantId, context.target.tenantId),
      eq(records.scopeId, context.scope.id),
      eq(records.domain, policy.domain),
      or(eq(records.audience, 'scope'), eq(records.ownerId, context.actor.principal.id)),
    );
  }

  private retention(policy: DomainPolicy): SQL | undefined {
    return policy.retention.activeDays === null
      ? undefined
      : gt(records.createdAt, new Date(Date.now() - policy.retention.activeDays * 86_400_000));
  }

  private sharing(context: ScopeAccess, changed: boolean) {
    if (changed && !context.actions.includes('share')) {
      throw new HttpError(403, 'scope_access_denied');
    }
  }

  private async quota(
    context: ScopeAccess,
    policy: DomainPolicy,
    title: string,
    body: string,
    current?: typeof records.$inferSelect,
  ) {
    const [usage] = await context.tx
      .select({
        count: sql<number>`count(*)::integer`,
        bytes: sql<number>`coalesce(sum(octet_length(${records.title}) + octet_length(${records.body})), 0)::bigint`,
      })
      .from(records)
      .where(
        and(
          eq(records.tenantId, context.target.tenantId),
          eq(records.scopeId, context.scope.id),
          eq(records.domain, policy.domain),
          isNull(records.deletedAt),
        ),
      );
    const size =
      Number(usage.bytes) -
      (current ? Buffer.byteLength(current.title) + Buffer.byteLength(current.body) : 0) +
      Buffer.byteLength(title) +
      Buffer.byteLength(body);

    if ((!current && usage.count >= policy.quotas.maxUnits) || size > policy.quotas.maxScopeBytes) {
      throw new HttpError(413, 'quota_exceeded');
    }
  }
}
