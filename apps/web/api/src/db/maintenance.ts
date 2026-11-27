import { persistenceSchema, vaultSchema, type BackupObjects } from '@visomi-stack/backend-db';
import { operationClockSkewMs, operationWindowMs, retentionDayMs, type DomainPolicy } from '@visomi-stack/shared-db';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { input, type Access, type ScopeAccess, type SessionActor } from '../access/service';

import { BackupPayloads } from './backup-payload';
import { scopeId, VaultAccess } from './vault-access';

export const maintenanceSchema = z.strictObject({ limit: z.number().int().min(1).max(100) });
const { records, commands } = persistenceSchema;
const { opaqueEvents: events, opaqueStreams: streams, opaqueUnits: units, keyChallenges } = vaultSchema;

/** Explicit owner operation; no scheduler, import-time work, client-supplied clock or retention override. */
export class PersistenceMaintenance {
  private readonly backups: BackupPayloads;

  constructor(
    private readonly access: Access,
    objects?: BackupObjects,
  ) {
    this.backups = new BackupPayloads(objects);
  }

  async deleteVault(actor: SessionActor, target: unknown, confirmation: string) {
    this.backups.requireObjects();
    const deleting = <T>(work: (context: ScopeAccess) => Promise<T>) =>
      this.access.withScope(
        actor,
        target,
        'delete',
        async (context) => {
          if (
            !context.membership.owner ||
            context.scope.kind !== 'resource' ||
            !context.scope.objectBackup ||
            context.scope.id !== confirmation
          ) {
            throw new HttpError(403, 'scope_access_denied');
          }

          return work(context);
        },
        true,
      );

    // Once destruction starts, failed external deletes remain retryable and the scope cannot accept new writes.
    await deleting(async (context) => {
      await context.tx
        .update(persistenceSchema.scopes)
        .set({ deletingBackup: true })
        .where(eq(persistenceSchema.scopes.id, context.scope.id));
    });

    return deleting(async (context) => {
      await this.backups.deleteScope(context);

      await context.tx
        .delete(persistenceSchema.scopes)
        .where(
          and(
            eq(persistenceSchema.scopes.tenantId, context.target.tenantId),
            eq(persistenceSchema.scopes.id, context.scope.id),
          ),
        );

      return { changed: true as const };
    });
  }

  async run(actor: SessionActor, target: unknown, domain: string, raw: unknown, objectOnly = false) {
    const { limit } = input(maintenanceSchema, raw);
    const policy = this.access.policy.domains.find((entry) => entry.domain === domain);

    if (!policy || policy.location === 'local') {
      throw new HttpError(409, 'domain_adapter_incompatible');
    }

    return this.access.withScope(actor, target, 'delete', async (context) => {
      if (!context.membership.owner || context.scope.kind !== policy.authorization.scope) {
        throw new HttpError(403, 'scope_access_denied');
      }

      if (context.scope.objectBackup) {
        if (policy.readers !== 'client-keys-only') {
          throw new HttpError(409, 'domain_adapter_incompatible');
        }

        const abandonedObjects = await this.backups.cleanup(context);

        return { receipts: 0, scrubbed: 0, purged: 0, events: 0, tombstones: 0, challenges: 0, abandonedObjects };
      }

      if (objectOnly) {
        throw new HttpError(409, 'capability_unavailable');
      }

      const now = Date.now();
      const receipts = await this.expireReceipts(context, policy, limit, now);

      if (policy.readers === 'server-authorized') {
        const result = await this.saas(context, policy, limit, now);

        return { receipts, ...result, events: 0, tombstones: 0, challenges: 0 };
      }

      const result = await this.opaque(context, policy, limit, now);

      return { receipts, ...result, scrubbed: 0, purged: 0 };
    });
  }

  private predicate(
    table: { tenantId: AnyPgColumn; scopeId: AnyPgColumn; domain: AnyPgColumn },
    context: ScopeAccess,
    domain: string,
  ) {
    return and(
      eq(table.tenantId, context.target.tenantId),
      eq(table.scopeId, context.scope.id),
      eq(table.domain, domain),
    );
  }

  private async expireReceipts(context: ScopeAccess, policy: DomainPolicy, limit: number, now: number) {
    const table = policy.readers === 'server-authorized' ? commands : vaultSchema.opaqueCommands;
    const predicate = this.predicate(table, context, policy.domain);
    // A future-dated accepted UUID still gets its complete retry window before its receipt can disappear.
    const cutoff = new Date(now - operationWindowMs(policy) - operationClockSkewMs);
    const expired = await context.tx
      .select({ userId: table.userId, operationId: table.operationId })
      .from(table)
      .where(and(predicate, lte(table.createdAt, cutoff)))
      .orderBy(asc(table.createdAt), asc(table.operationId))
      .limit(limit);

    for (const row of expired) {
      await context.tx
        .delete(table)
        .where(and(predicate, eq(table.userId, row.userId), eq(table.operationId, row.operationId)));
    }

    return expired.length;
  }

  private async saas(context: ScopeAccess, policy: DomainPolicy, limit: number, now: number) {
    const predicate = this.predicate(records, context, policy.domain);
    let scrubbed = 0;

    if (policy.retention.activeDays !== null) {
      const duration = policy.retention.activeDays * retentionDayMs;
      const expired = await context.tx
        .select({ id: records.id, createdAt: records.createdAt })
        .from(records)
        .where(and(predicate, isNull(records.deletedAt), lte(records.createdAt, new Date(now - duration))))
        .orderBy(asc(records.createdAt), asc(records.id))
        .limit(limit);

      for (const row of expired) {
        await context.tx
          .update(records)
          .set({
            title: '',
            body: '',
            deletedAt: new Date(row.createdAt.getTime() + duration),
            updatedAt: new Date(now),
          })
          .where(and(predicate, eq(records.id, row.id)));
      }

      scrubbed = expired.length;
    }

    const expired = await context.tx
      .select({ id: records.id })
      .from(records)
      .where(
        and(predicate, lte(records.deletedAt, new Date(now - policy.retention.deletionGraceDays * retentionDayMs))),
      )
      .orderBy(asc(records.deletedAt), asc(records.id))
      .limit(limit);

    if (expired.length) {
      await context.tx.delete(records).where(
        and(
          predicate,
          inArray(
            records.id,
            expired.map((row) => row.id),
          ),
        ),
      );
    }

    return { scrubbed, purged: expired.length };
  }

  private async opaque(
    context: ScopeAccess,
    policy: Extract<DomainPolicy, { readers: 'client-keys-only' }>,
    limit: number,
    now: number,
  ) {
    const key = new VaultAccess(this.access).key(context, policy, 1);
    const challenges = await context.tx
      .select({ id: keyChallenges.id })
      .from(keyChallenges)
      .where(
        and(
          eq(keyChallenges.tenantId, context.target.tenantId),
          eq(keyChallenges.scopeId, scopeId(key.scope)),
          eq(keyChallenges.domain, policy.domain),
          lte(keyChallenges.expiresAt, new Date(now)),
        ),
      )
      .orderBy(asc(keyChallenges.expiresAt), asc(keyChallenges.id))
      .limit(limit);

    if (challenges.length) {
      await context.tx.delete(keyChallenges).where(
        and(
          eq(keyChallenges.tenantId, context.target.tenantId),
          eq(keyChallenges.scopeId, scopeId(key.scope)),
          eq(keyChallenges.domain, policy.domain),
          inArray(
            keyChallenges.id,
            challenges.map((row) => row.id),
          ),
        ),
      );
    }

    const predicate = this.predicate(streams, context, policy.domain);
    const [stream] = await context.tx.select().from(streams).where(predicate);

    if (!stream) {
      return { events: 0, tombstones: 0, challenges: challenges.length };
    }

    const cutoff = new Date(
      now -
        Math.max(
          policy.retention.tombstoneDays,
          policy.retention.offlineWindowDays,
          policy.retention.deletionGraceDays,
        ) *
          retentionDayMs,
    );
    const candidates = await context.tx
      .select()
      .from(events)
      .where(and(this.predicate(events, context, policy.domain), gt(events.cursor, stream.floorCursor)))
      .orderBy(asc(events.cursor))
      .limit(limit);
    let cursor = stream.floorCursor;
    let checkpoint = stream.floorCheckpoint;
    let compacted = 0;

    for (const event of candidates) {
      if (event.createdAt > cutoff) {
        break;
      }

      if (event.cursor !== cursor + 1 || event.previousCheckpoint !== checkpoint) {
        throw new HttpError(409, 'sync_checkpoint_conflict');
      }

      cursor = event.cursor;
      checkpoint = event.checkpoint;
      compacted++;
    }

    if (compacted) {
      await context.tx.update(streams).set({ floorCursor: cursor, floorCheckpoint: checkpoint }).where(predicate);

      await context.tx
        .delete(events)
        .where(
          and(
            this.predicate(events, context, policy.domain),
            gt(events.cursor, stream.floorCursor),
            lte(events.cursor, cursor),
          ),
        );
    }

    const tombstones = await context.tx
      .select({ id: units.id })
      .from(units)
      .where(
        and(
          this.predicate(units, context, policy.domain),
          eq(units.tombstone, true),
          isNotNull(units.envelope),
          lte(units.cursor, cursor),
          lte(units.updatedAt, cutoff),
        ),
      )
      .orderBy(asc(units.cursor))
      .limit(limit);

    if (tombstones.length) {
      // Keep minimal revision gravestones. Removing them would permit stale ciphertext to resurrect a deleted object.
      await context.tx
        .update(units)
        .set({ envelope: null, bytes: 0 })
        .where(
          and(
            this.predicate(units, context, policy.domain),
            inArray(
              units.id,
              tombstones.map((row) => row.id),
            ),
          ),
        );
    }

    return { events: compacted, tombstones: tombstones.length, challenges: challenges.length };
  }
}
