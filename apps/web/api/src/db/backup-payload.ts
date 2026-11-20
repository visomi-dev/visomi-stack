import { randomUUID } from 'node:crypto';

import type { BackupObjects, vaultSchema } from '@visomi-stack/backend-db';
import { dataEnvelopeSchema, deserializeDataEnvelope, encodedBytes, type DataEnvelope } from '@visomi-stack/shared-db';
import { HttpError } from '@visomi-stack/web-backend-shared';
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

export class BackupPayloads {
  constructor(private readonly objects?: BackupObjects) {}

  async publish(context: ScopeAccess, envelope: DataEnvelope, wire: string, bytes: number): Promise<StoredEnvelope> {
    const id = randomUUID();
    const key = this.key(context, id);
    const digest = publicHash(wire);
    const objects = this.requireObjects();

    try {
      await objects.put(key, wire);

      const stored = await objects.get(key, bytes);

      if (stored !== wire) {
        throw new Error();
      }
    } catch {
      throw new HttpError(503, 'vault_backup_unavailable');
    }

    return { format: 'vault-object', version: 1, id, digest, generation: envelope.context.key.generation };
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

  requireObjects(): BackupObjects {
    if (!this.objects) {
      throw new HttpError(503, 'vault_backup_unavailable');
    }

    return this.objects;
  }

  private key(context: ScopeAccess, id: string) {
    return `vault-backups/${context.scope.id}/${id}`;
  }
}
