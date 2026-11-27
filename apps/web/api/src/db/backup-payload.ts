import { randomUUID } from 'node:crypto';

import { vaultSchema, type BackupObjects } from '@visomi-stack/backend-db';
import { dataEnvelopeSchema, deserializeDataEnvelope, encodedBytes, type DataEnvelope } from '@visomi-stack/shared-db';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { ScopeAccess } from '../access/service';

import { publicHash } from './device-proof';

const referenceSchema = z.strictObject({
  format: z.literal('vault-object'),
  version: z.literal(1),
  id: z.uuid(),
  digest: encodedBytes(32),
  generation: z.number().int().positive(),
});

type StoredEnvelope = typeof vaultSchema.opaqueEvents.$inferSelect.envelope;
export type BackupReservation = { id: string; retry: boolean };
const { backupStaging } = vaultSchema;

export class BackupPayloads {
  constructor(private readonly objects?: BackupObjects) {}

  async reserve(
    context: ScopeAccess,
    operationId: string,
    fingerprint: string,
    bytes: number,
  ): Promise<BackupReservation> {
    this.requireObjects();
    const prior = await this.staged(context);
    const now = Date.now();
    const expiresAt = new Date(now + 60_000);

    if (prior && prior.expiresAt.getTime() > now) {
      if (prior.ownerId !== context.actor.principal.id || prior.operationId !== operationId) {
        throw new HttpError(503, 'vault_backup_unavailable');
      }

      if (prior.fingerprint !== fingerprint || prior.bytes !== bytes) {
        throw new HttpError(409, 'idempotency_conflict');
      }

      await context.tx.update(backupStaging).set({ expiresAt }).where(eq(backupStaging.scopeId, context.scope.id));

      return { id: prior.id, retry: true };
    }

    if (prior) {
      await this.cleanup(context);
    }

    const id = randomUUID();

    await context.tx.insert(backupStaging).values({
      tenantId: context.scope.tenantId,
      scopeId: context.scope.id,
      ownerId: context.actor.principal.id,
      operationId,
      fingerprint,
      bytes,
      expiresAt,
      id,
    });

    return { id, retry: false };
  }

  async cleanup(context: ScopeAccess): Promise<number> {
    const staged = await this.staged(context);

    if (!staged || staged.expiresAt.getTime() > Date.now()) {
      return 0;
    }

    try {
      await this.requireObjects().delete(this.key(context, staged.id));
    } catch {
      // Keep the slot charged until the store confirms deletion.
      throw new HttpError(503, 'vault_backup_unavailable');
    }

    await this.clear(context, staged.id);

    return 1;
  }

  async publish(
    context: ScopeAccess,
    reservation: BackupReservation,
    envelope: DataEnvelope,
    wire: string,
    bytes: number,
  ): Promise<StoredEnvelope> {
    const { id } = reservation;
    const staged = await this.staged(context);

    // Leave more than the signed request lifetime for a PUT before allowing reclamation.
    if (!staged || staged.id !== id || staged.expiresAt.getTime() <= Date.now() + 20_000) {
      throw new HttpError(503, 'vault_backup_unavailable');
    }

    const key = this.key(context, id);
    const digest = publicHash(wire);
    const objects = this.requireObjects();

    try {
      try {
        await objects.put(key, wire);
      } catch (error) {
        if (!reservation.retry) {
          throw error;
        }
        // An earlier conditional PUT may have succeeded before its response or read-back failed.
      }

      const stored = await objects.get(key, bytes);

      if (stored !== wire) {
        throw new Error();
      }
    } catch {
      throw new HttpError(503, 'vault_backup_unavailable');
    }

    return { format: 'vault-object', version: 1, id, digest, generation: envelope.context.key.generation };
  }

  async clear(context: ScopeAccess, id: string): Promise<void> {
    await context.tx
      .delete(backupStaging)
      .where(and(eq(backupStaging.scopeId, context.scope.id), eq(backupStaging.id, id)));
  }

  async read(context: ScopeAccess, value: StoredEnvelope, bytes: number): Promise<DataEnvelope> {
    if (!context.scope.objectBackup) {
      return dataEnvelopeSchema.parse(value);
    }

    const objects = this.requireObjects();

    try {
      const reference = referenceSchema.parse(value);

      if (bytes < 1 || bytes > 1_410_000) {
        throw new Error();
      }

      const wire = await objects.get(this.key(context, reference.id), bytes);

      if (Buffer.byteLength(wire) !== bytes || publicHash(wire) !== reference.digest) {
        throw new Error();
      }

      const envelope = deserializeDataEnvelope(wire);

      if (reference.generation !== envelope.context.key.generation) {
        throw new Error();
      }

      return envelope;
    } catch {
      throw new HttpError(503, 'vault_backup_unavailable');
    }
  }

  async deleteScope(context: ScopeAccess): Promise<void> {
    const store = this.requireObjects();
    const staged = await this.staged(context);

    if (staged && staged.expiresAt.getTime() > Date.now()) {
      throw new HttpError(409, 'vault_backup_busy');
    }

    // Events retain the immutable ciphertext references, including earlier revisions.
    const events = vaultSchema.opaqueEvents;
    const rows = await context.tx
      .select({ envelope: events.envelope })
      .from(events)
      .where(and(eq(events.tenantId, context.scope.tenantId), eq(events.scopeId, context.scope.id)));
    const ids = new Set(rows.map(({ envelope }) => referenceSchema.parse(envelope).id));

    if (staged) {
      ids.add(staged.id);
    }

    for (const id of ids) {
      await store.delete(this.key(context, id));
    }

    if (staged) {
      await this.clear(context, staged.id);
    }
  }

  requireObjects(): BackupObjects {
    if (!this.objects) {
      throw new HttpError(503, 'vault_backup_unavailable');
    }

    return this.objects;
  }

  private key(context: ScopeAccess, id: string) {
    return `vault-backups/${context.scope.id}/${id}`;
  }

  private async staged(context: ScopeAccess) {
    const [staged] = await context.tx.select().from(backupStaging).where(eq(backupStaging.scopeId, context.scope.id));

    return staged;
  }
}
