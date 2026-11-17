import { z } from 'zod';
import {
  dataEnvelopeSchema,
  serializeDataEnvelope,
  syncHeadSchema,
  syncWriteSchema,
  VaultError,
  type DataEnvelope,
  type SyncEvent,
} from '@visomi-stack/shared-db';

import { ReplicaDatabase, openDatabase, storageError } from './database';
import type { PendingWrite, ReplicaPin, ReplicaStorage } from './replica';

const pinSchema = syncHeadSchema.safeExtend({
  generation: z.number().int().min(1).max(2_147_483_647),
  epoch: z.number().int().min(1).max(2_147_483_647),
});
const outboxSchema = z.strictObject({ value: syncWriteSchema, seen: z.boolean() });
const initial = (): ReplicaPin => ({ cursor: 0, checkpoint: null, generation: 1, epoch: 1 });
const same = (left: ReplicaPin, right: ReplicaPin) =>
  left.cursor === right.cursor &&
  left.checkpoint === right.checkpoint &&
  left.generation === right.generation &&
  left.epoch === right.epoch;

/** Ciphertext and allowlisted protocol metadata only. Pins and unit revisions commit atomically across tabs. */
export class IndexedDbReplicaStorage implements ReplicaStorage {
  private constructor(private readonly database: ReplicaDatabase) {}

  static async open(factory: IDBFactory | undefined, ownerId: string): Promise<IndexedDbReplicaStorage> {
    if (!factory) {
      throw new VaultError('unavailable');
    }

    const database = await openDatabase(
      new ReplicaDatabase(ownerId, factory),
      factory,
      ['pins', 'units', 'outbox'],
      null,
    );

    return new IndexedDbReplicaStorage(database);
  }

  async pin(id: string): Promise<ReplicaPin> {
    const value = await this.read('pins', id);

    if (value === undefined) {
      return initial();
    }

    const result = pinSchema.safeParse(value);

    if (!result.success) {
      throw new VaultError('corrupt');
    }

    return result.data;
  }

  async unit(id: string, objectId: string): Promise<DataEnvelope | undefined> {
    const value = await this.read('units', JSON.stringify([id, objectId]));

    if (value === undefined) {
      return undefined;
    }

    const result = dataEnvelopeSchema.safeParse(value);

    if (!result.success || result.data.context.objectId !== objectId) {
      throw new VaultError('corrupt');
    }

    return result.data;
  }

  async pending(id: string): Promise<PendingWrite | undefined> {
    const value = await this.read('outbox', id);

    if (value === undefined) {
      return undefined;
    }

    const result = outboxSchema.safeParse(value);

    if (!result.success) {
      throw new VaultError('corrupt');
    }

    return result.data.value;
  }

  async enqueue(id: string, value: PendingWrite): Promise<void> {
    const parsed = syncWriteSchema.safeParse(value);

    if (!parsed.success) {
      throw new VaultError('corrupt');
    }

    await this.transaction(async () => {
      const raw = await this.database.outbox.get(id);
      const current = outboxSchema.safeParse(raw);

      if (
        raw !== undefined &&
        (!current.success || JSON.stringify(current.data.value) !== JSON.stringify(parsed.data))
      ) {
        throw new VaultError('revision-conflict');
      }

      await this.database.outbox.put({ value: parsed.data, seen: current.success ? current.data.seen : false }, id);
    });
  }

  async acknowledged(id: string, operationId: string): Promise<void> {
    await this.transaction(async () => {
      const raw = await this.database.outbox.get(id);
      const current = outboxSchema.safeParse(raw);

      if (!current.success || current.data.value.operationId !== operationId || !current.data.seen) {
        throw new VaultError('corrupt');
      }

      await this.database.outbox.delete(id);
    });
  }

  async resolve(id: string, operationId: string, replacement: PendingWrite | null): Promise<void> {
    const parsed = replacement === null ? null : syncWriteSchema.safeParse(replacement);

    if (parsed && !parsed.success) {
      throw new VaultError('corrupt');
    }

    await this.transaction(async () => {
      const raw = await this.database.outbox.get(id);
      const pending = outboxSchema.safeParse(raw);

      if (!pending.success || pending.data.value.operationId !== operationId) {
        throw new VaultError('revision-conflict');
      }

      if (!parsed) {
        await this.database.outbox.delete(id);

        return;
      }

      if (!parsed.success) {
        throw new VaultError('corrupt');
      }

      const value = parsed.data;
      const before = pending.data.value.envelope.context;
      const after = value.envelope.context;

      if (
        value.operationId === operationId ||
        before.objectId !== after.objectId ||
        JSON.stringify(before.target) !== JSON.stringify(after.target) ||
        before.key.product !== after.key.product ||
        before.key.domain !== after.key.domain ||
        JSON.stringify(before.key.scope) !== JSON.stringify(after.key.scope)
      ) {
        throw new VaultError('revision-conflict');
      }

      const pinned = await this.database.pins.get(id);
      const pin = pinned === undefined ? initial() : pinSchema.safeParse(pinned).data;

      if (
        !pin ||
        value.head.cursor !== pin.cursor ||
        value.head.checkpoint !== pin.checkpoint ||
        value.envelope.context.previousCheckpoint !== pin.checkpoint ||
        value.envelope.context.key.generation !== pin.generation ||
        value.authorization.epoch !== pin.epoch ||
        value.envelope.context.revision !== value.expectedRevision + 1
      ) {
        throw new VaultError('revision-conflict');
      }

      const unit = await this.database.units.get(JSON.stringify([id, after.objectId]));
      const current = dataEnvelopeSchema.safeParse(unit);

      if (
        (unit !== undefined && !current.success) ||
        value.expectedRevision !== (current.success ? current.data.context.revision : 0)
      ) {
        throw new VaultError('revision-conflict');
      }

      await this.database.outbox.put({ value, seen: false }, id);
    });
  }

  /** Retain an authorized roster floor even if synchronization or its view is interrupted. */
  async advanceEpoch(id: string, minimumEpoch: number): Promise<void> {
    await this.transaction(async () => {
      const current = await this.pin(id);
      const next = pinSchema.safeParse({ ...current, epoch: Math.max(current.epoch, minimumEpoch) });

      if (!Number.isSafeInteger(minimumEpoch) || minimumEpoch < 1 || !next.success) {
        throw new VaultError('corrupt');
      }

      await this.database.pins.put(next.data, id);
    });
  }

  async commit(id: string, expected: ReplicaPin, next: ReplicaPin, events: readonly SyncEvent[]): Promise<void> {
    const parsed = pinSchema.safeParse(next);

    if (!parsed.success) {
      throw new VaultError('corrupt');
    }

    await this.transaction(async () => {
      const raw = await this.database.pins.get(id);
      const current = raw === undefined ? initial() : pinSchema.safeParse(raw).data;

      if (!current || !same(current, expected)) {
        throw new VaultError('revision-conflict');
      }

      const outbox = await this.database.outbox.get(id);
      const pending = outboxSchema.safeParse(outbox);

      if (outbox !== undefined && !pending.success) {
        throw new VaultError('corrupt');
      }

      if (
        pending.success &&
        events.some(
          (event) => serializeDataEnvelope(event.envelope) === serializeDataEnvelope(pending.data.value.envelope),
        )
      ) {
        await this.database.outbox.put({ ...pending.data, seen: true }, id);
      }

      for (const event of events) {
        const envelope = dataEnvelopeSchema.safeParse(event.envelope);

        if (!envelope.success) {
          throw new VaultError('corrupt');
        }

        const key = JSON.stringify([id, envelope.data.context.objectId]);
        const existing = await this.database.units.get(key);
        const stored = dataEnvelopeSchema.safeParse(existing);

        if (
          (existing !== undefined && !stored.success) ||
          envelope.data.context.revision !== (stored.success ? stored.data.context.revision : 0) + 1 ||
          (stored.success && envelope.data.context.key.generation < stored.data.context.key.generation)
        ) {
          throw new VaultError('revision-conflict');
        }

        await this.database.units.put(envelope.data, key);
      }

      await this.database.pins.put(parsed.data, id);
    });
  }

  close(): void {
    this.database.close();
  }

  private async read(store: string, id: string): Promise<unknown> {
    try {
      const value = await this.database.table<unknown, string>(store).get(id);

      return value;
    } catch (error) {
      throw storageError(error);
    }
  }

  private async transaction(work: () => Promise<void>): Promise<void> {
    try {
      // Only IndexedDB promises belong here: AEAD and HTTP complete before entering this transaction.
      await this.database.transaction('rw', this.database.pins, this.database.units, this.database.outbox, work);
    } catch (error) {
      throw storageError(error);
    }
  }
}
