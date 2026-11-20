import { vaultSchema, type BackupObjects } from '@visomi-stack/backend-db';
import type { RealtimePublisher } from '@visomi-stack/backend-shared';
import {
  dataAad,
  serializeDataEnvelope,
  syncWriteSchema,
  syncReadSchema,
  syncReadBody,
  syncCheckpointMessage,
  type SyncHead,
} from '@visomi-stack/shared-db';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { input, type Access, type ScopeAccess, type SessionActor } from '../access/service';

import { publicHash } from './device-proof';
import { VaultAccess } from './vault-access';
import { requireCurrentOperation } from './operation-time';
import { BackupPayloads, type BackupReservation } from './backup-payload';
import { requireSyncDevice } from './sync-device';

const { opaqueUnits: units, opaqueEvents: events, opaqueStreams: streams, opaqueCommands: commands } = vaultSchema;

/** Bounded ciphertext transport with append-only cursors and scope-selected private storage. */
export class OpaqueSync {
  private readonly vault: VaultAccess;
  private readonly payloads: BackupPayloads;

  constructor(
    private readonly access: Access,
    objects?: BackupObjects,
    private readonly notifyVault?: RealtimePublisher['notifyVault'],
  ) {
    this.vault = new VaultAccess(access);
    this.payloads = new BackupPayloads(objects);
  }

  async read(actor: SessionActor, target: unknown, domain: string, raw: unknown, csrf?: string) {
    const value = input(syncReadSchema, raw);
    const policy = this.vault.policy(domain);

    return this.access.withScope(actor, target, 'read', async (context) => {
      this.scope(context, policy.authorization.scope);
      const { registry, key } = await this.vault.registry(context, policy);

      if (context.scope.objectBackup) {
        const proof = value.authorization;

        if (!proof || !csrf) {
          throw new HttpError(403, 'device_approval_required');
        }

        await requireSyncDevice(context, key, registry.epoch, proof, proof.operationId, syncReadBody(value, csrf));

        requireCurrentOperation(proof.operationId, policy);
        this.payloads.requireObjects();
      }

      const head = await this.head(context, domain);

      await this.anchor(context, domain, value.head, head);

      const candidates = await context.tx
        .select({
          cursor: events.cursor,
          checkpoint: events.checkpoint,
          previousCheckpoint: events.previousCheckpoint,
          envelope: events.envelope,
          bytes: events.bytes,
        })
        .from(events)
        .where(and(this.predicate(events, context, domain), gt(events.cursor, value.head.cursor)))
        .orderBy(asc(events.cursor))
        .limit(value.limit);
      let bytes = 0;
      const selected = candidates.filter((item) => {
        bytes += item.bytes;

        return bytes <= 2_097_152;
      });
      const page = await Promise.all(
        selected.map(async ({ bytes, envelope, ...event }) => {
          const opened = await this.payloads.read(context, envelope, bytes);

          return { ...event, envelope: opened };
        }),
      );
      const cursor = page.at(-1)?.cursor ?? value.head.cursor;

      return {
        protocol: 1 as const,
        generation: registry.generation,
        epoch: registry.epoch,
        phase: registry.phase,
        head,
        events: page,
        more: cursor < head.cursor,
      };
    });
  }

  async write(actor: SessionActor, target: unknown, domain: string, raw: unknown) {
    const value = input(syncWriteSchema, raw);
    const policy = this.vault.policy(domain);
    const wire = serializeDataEnvelope(value.envelope);
    const bytes = Buffer.byteLength(wire);

    if (Buffer.from(value.envelope.ciphertext, 'base64url').byteLength > policy.quotas.maxUnitBytes + 16) {
      throw new HttpError(413, 'quota_exceeded');
    }

    const action = value.envelope.context.kind === 'tombstone' ? 'delete' : 'write';
    const write = (reservation?: BackupReservation) =>
      this.access.withScope(actor, target, action, async (context) => {
        this.scope(context, policy.authorization.scope);
        const { registry, key } = await this.vault.registry(context, policy);

        if (registry.phase !== 'ready') {
          throw new HttpError(409, 'rotation_required');
        }

        const expected = { ...value.envelope.context, key, target: this.vault.identity(context) };

        if (dataAad(expected) !== dataAad(value.envelope.context)) {
          throw new HttpError(409, 'envelope_context_invalid');
        }

        const body = {
          protocol: value.protocol,
          operationId: value.operationId,
          expectedRevision: value.expectedRevision,
          head: value.head,
          envelope: value.envelope,
        };

        await requireSyncDevice(context, key, registry.epoch, value.authorization, value.operationId, body);

        requireCurrentOperation(value.operationId, policy);
        const fingerprint = publicHash(JSON.stringify(body));
        const [previous] = await context.tx
          .select()
          .from(commands)
          .where(
            and(
              this.predicate(commands, context, domain),
              eq(commands.userId, actor.principal.id),
              eq(commands.operationId, value.operationId),
            ),
          );

        if (previous) {
          if (previous.fingerprint !== fingerprint) {
            throw new HttpError(409, 'idempotency_conflict');
          }

          return { cursor: previous.cursor, checkpoint: previous.checkpoint };
        }

        const head = await this.head(context, domain);

        if (
          head.cursor !== value.head.cursor ||
          head.checkpoint !== value.head.checkpoint ||
          value.envelope.context.previousCheckpoint !== head.checkpoint
        ) {
          throw new HttpError(409, 'sync_conflict');
        }

        const [current] = await context.tx
          .select()
          .from(units)
          .where(and(this.predicate(units, context, domain), eq(units.id, value.envelope.context.objectId)));

        if (
          (current?.revision ?? 0) !== value.expectedRevision ||
          value.envelope.context.revision !== value.expectedRevision + 1
        ) {
          throw new HttpError(409, 'revision_conflict');
        }

        if (head.cursor >= 2_147_483_647) {
          throw new HttpError(409, 'cursor_exhausted');
        }

        const [usage] = await context.tx
          .select({
            bytes: sql<number>`coalesce(sum(${units.bytes}),0)::integer`,
            count: sql<number>`count(*)::integer`,
          })
          .from(units)
          .where(this.predicate(units, context, domain));
        const [history] = await context.tx
          .select({ bytes: sql<number>`coalesce(sum(${events.bytes}),0)::integer` })
          .from(events)
          .where(this.predicate(events, context, domain));

        if (
          usage.count + (current ? 0 : 1) > policy.quotas.maxUnits ||
          usage.bytes - (current?.bytes ?? 0) + history.bytes + bytes * 2 > policy.quotas.maxScopeBytes
        ) {
          throw new HttpError(413, 'quota_exceeded');
        }

        const cursor = head.cursor + 1;
        const checkpoint = publicHash(syncCheckpointMessage(cursor, head.checkpoint, value.envelope));
        let envelope: typeof events.$inferInsert.envelope = value.envelope;

        if (context.scope.objectBackup) {
          if (!reservation) {
            const slot = await this.payloads.reserve(context, value.operationId, fingerprint, bytes);

            return { cursor, checkpoint, reservation: slot };
          }

          const saved = await this.payloads.publish(context, reservation, value.envelope, wire, bytes);

          envelope = saved;
        }

        const row = {
          tenantId: context.target.tenantId,
          scopeId: context.scope.id,
          domain,
          id: value.envelope.context.objectId,
          revision: value.envelope.context.revision,
          generation: key.generation,
          cursor,
          checkpoint,
          envelope,
          bytes,
          tombstone: value.envelope.context.kind === 'tombstone',
        };

        await context.tx
          .insert(units)
          .values(row)
          .onConflictDoUpdate({
            target: [units.tenantId, units.scopeId, units.domain, units.id],
            set: { ...row, updatedAt: new Date() },
          });

        await context.tx.insert(events).values({
          tenantId: row.tenantId,
          scopeId: row.scopeId,
          domain,
          cursor,
          checkpoint,
          previousCheckpoint: head.checkpoint,
          envelope,
          bytes,
        });

        await context.tx
          .insert(streams)
          .values({ tenantId: row.tenantId, scopeId: row.scopeId, domain, cursor, checkpoint })
          .onConflictDoUpdate({
            target: [streams.tenantId, streams.scopeId, streams.domain],
            set: { cursor, checkpoint },
          });

        await context.tx.insert(commands).values({
          tenantId: row.tenantId,
          scopeId: row.scopeId,
          domain,
          userId: actor.principal.id,
          operationId: value.operationId,
          fingerprint,
          cursor,
          checkpoint,
        });

        if (reservation) {
          await this.payloads.clear(context, reservation.id);
        }

        return { cursor, checkpoint, backupScope: reservation ? context.scope.id : undefined };
      });

    // Record the slot before anything can reach S3. Publication then rechecks authority and head under the tenant lock.
    const result = await write();

    if (result.reservation) {
      const published = await write(result.reservation);

      if (published.backupScope) {
        void this.notifyVault?.(published.backupScope, published.cursor).catch(() => undefined);
      }

      return { cursor: published.cursor, checkpoint: published.checkpoint };
    }

    return { cursor: result.cursor, checkpoint: result.checkpoint };
  }

  private scope(context: ScopeAccess, kind: string) {
    if (context.scope.kind !== kind) {
      throw new HttpError(403, 'scope_access_denied');
    }
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

  private async head(context: ScopeAccess, domain: string): Promise<SyncHead> {
    const [head] = await context.tx
      .select({ cursor: streams.cursor, checkpoint: streams.checkpoint })
      .from(streams)
      .where(this.predicate(streams, context, domain));

    return head ?? { cursor: 0, checkpoint: null };
  }

  private async anchor(context: ScopeAccess, domain: string, requested: SyncHead, current: SyncHead) {
    if (requested.cursor > current.cursor) {
      throw new HttpError(409, 'sync_rollback_detected');
    }

    const [stream] = await context.tx
      .select()
      .from(streams)
      .where(this.predicate(streams, context, domain));
    const floor = stream?.floorCursor ?? 0;

    if (requested.cursor < floor) {
      throw new HttpError(409, 'sync_history_expired');
    }

    if (floor > 0 && requested.cursor === floor) {
      if (requested.checkpoint !== stream?.floorCheckpoint) {
        throw new HttpError(409, 'sync_checkpoint_conflict');
      }

      return;
    }

    if (requested.cursor === 0) {
      return;
    }

    const [anchor] = await context.tx
      .select({ checkpoint: events.checkpoint })
      .from(events)
      .where(and(this.predicate(events, context, domain), eq(events.cursor, requested.cursor)));

    if (!anchor || anchor.checkpoint !== requested.checkpoint) {
      throw new HttpError(409, 'sync_checkpoint_conflict');
    }
  }
}
