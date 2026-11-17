import { z } from 'zod';
import {
  dataEnvelopeSchema,
  serializeDataEnvelope,
  syncHeadSchema,
  syncWriteSchema,
  VaultError,
  type DataEnvelope,
  type SyncEvent,
} from '@visomi-stack/shared-persistence';

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
  private constructor(private readonly database: IDBDatabase) {}

  static async open(factory: IDBFactory | undefined, ownerId: string): Promise<IndexedDbReplicaStorage> {
    if (!factory) {
      throw new VaultError('unavailable');
    }

    return new Promise((resolve, reject) => {
      const request = factory.open(`visomi-sync:${ownerId}`, 1);
      let blocked = false;

      request.onupgradeneeded = () => {
        for (const name of ['pins', 'units', 'outbox']) {
          request.result.createObjectStore(name);
        }
      };
      request.onerror = () => reject(new VaultError('unavailable'));
      request.onblocked = () => {
        blocked = true;
        reject(new VaultError('unavailable'));
      };
      request.onsuccess = () => {
        if (blocked) {
          request.result.close();

          return;
        }

        request.result.onversionchange = () => request.result.close();
        resolve(new IndexedDbReplicaStorage(request.result));
      };
    });
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

  enqueue(id: string, value: PendingWrite): Promise<void> {
    const parsed = syncWriteSchema.safeParse(value);

    if (!parsed.success) {
      throw new VaultError('corrupt');
    }

    return this.transaction(['outbox'], (tx, fail) => {
      const store = tx.objectStore('outbox');
      const request = store.get(id);

      request.onsuccess = () => {
        const current = outboxSchema.safeParse(request.result);

        if (
          request.result !== undefined &&
          (!current.success || JSON.stringify(current.data.value) !== JSON.stringify(parsed.data))
        ) {
          fail(new VaultError('revision-conflict'));

          return;
        }

        store.put({ value: parsed.data, seen: current.success ? current.data.seen : false }, id);
      };
    });
  }

  acknowledged(id: string, operationId: string): Promise<void> {
    return this.transaction(['outbox'], (tx, fail) => {
      const store = tx.objectStore('outbox');
      const request = store.get(id);

      request.onsuccess = () => {
        const current = outboxSchema.safeParse(request.result);

        if (!current.success || current.data.value.operationId !== operationId || !current.data.seen) {
          fail(new VaultError('corrupt'));

          return;
        }

        store.delete(id);
      };
    });
  }

  resolve(id: string, operationId: string, replacement: PendingWrite | null): Promise<void> {
    const parsed = replacement === null ? null : syncWriteSchema.safeParse(replacement);

    if (parsed && !parsed.success) {
      throw new VaultError('corrupt');
    }

    return this.transaction(['outbox', 'pins', 'units'], (tx, fail) => {
      const outbox = tx.objectStore('outbox');
      const request = outbox.get(id);

      request.onsuccess = () => {
        const pending = outboxSchema.safeParse(request.result);

        if (!pending.success || pending.data.value.operationId !== operationId) {
          fail(new VaultError('revision-conflict'));

          return;
        }

        if (!parsed) {
          outbox.delete(id);

          return;
        }

        if (!parsed.success) {
          fail(new VaultError('corrupt'));

          return;
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
          fail(new VaultError('revision-conflict'));

          return;
        }

        const pinned = tx.objectStore('pins').get(id);

        pinned.onsuccess = () => {
          const pin = pinned.result === undefined ? initial() : pinSchema.safeParse(pinned.result).data;

          if (
            !pin ||
            value.head.cursor !== pin.cursor ||
            value.head.checkpoint !== pin.checkpoint ||
            value.envelope.context.previousCheckpoint !== pin.checkpoint ||
            value.envelope.context.key.generation !== pin.generation ||
            value.authorization.epoch !== pin.epoch ||
            value.envelope.context.revision !== value.expectedRevision + 1
          ) {
            fail(new VaultError('revision-conflict'));

            return;
          }

          const unit = tx.objectStore('units').get(JSON.stringify([id, after.objectId]));

          unit.onsuccess = () => {
            const current = dataEnvelopeSchema.safeParse(unit.result);

            if (
              (unit.result !== undefined && !current.success) ||
              value.expectedRevision !== (current.success ? current.data.context.revision : 0)
            ) {
              fail(new VaultError('revision-conflict'));

              return;
            }

            outbox.put({ value, seen: false }, id);
          };
        };
      };
    });
  }

  commit(id: string, expected: ReplicaPin, next: ReplicaPin, events: readonly SyncEvent[]): Promise<void> {
    const parsed = pinSchema.safeParse(next);

    if (!parsed.success) {
      throw new VaultError('corrupt');
    }

    return this.transaction(['pins', 'units', 'outbox'], (tx, fail) => {
      const pins = tx.objectStore('pins');
      const request = pins.get(id);

      request.onsuccess = () => {
        const current = request.result === undefined ? initial() : pinSchema.safeParse(request.result).data;

        if (!current || !same(current, expected)) {
          fail(new VaultError('revision-conflict'));

          return;
        }

        const outbox = tx.objectStore('outbox');
        const pendingRequest = outbox.get(id);

        pendingRequest.onsuccess = () => {
          const pending = outboxSchema.safeParse(pendingRequest.result);

          if (pendingRequest.result !== undefined && !pending.success) {
            fail(new VaultError('corrupt'));

            return;
          }

          if (
            pending.success &&
            events.some(
              (event) => serializeDataEnvelope(event.envelope) === serializeDataEnvelope(pending.data.value.envelope),
            )
          ) {
            outbox.put({ ...pending.data, seen: true }, id);
          }

          let index = 0;
          const apply = () => {
            const event = events[index++];

            if (!event) {
              pins.put(parsed.data, id);

              return;
            }

            const envelope = dataEnvelopeSchema.safeParse(event.envelope);

            if (!envelope.success) {
              fail(new VaultError('corrupt'));

              return;
            }

            const key = JSON.stringify([id, envelope.data.context.objectId]);
            const units = tx.objectStore('units');
            const existing = units.get(key);

            existing.onsuccess = () => {
              const stored = dataEnvelopeSchema.safeParse(existing.result);

              if (
                (existing.result !== undefined && !stored.success) ||
                envelope.data.context.revision !== (stored.success ? stored.data.context.revision : 0) + 1 ||
                (stored.success && envelope.data.context.key.generation < stored.data.context.key.generation)
              ) {
                fail(new VaultError('revision-conflict'));

                return;
              }

              units.put(envelope.data, key);
              apply();
            };
          };

          apply();
        };
      };
    });
  }

  close(): void {
    this.database.close();
  }

  private read(store: string, id: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;

      try {
        tx = this.database.transaction(store, 'readonly');
      } catch {
        reject(new VaultError('unavailable'));

        return;
      }
      const request = tx.objectStore(store).get(id);
      let value: unknown;

      request.onsuccess = () => {
        value = request.result;
      };
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () => reject(new VaultError('unavailable'));
    });
  }

  private transaction(
    stores: string[],
    work: (tx: IDBTransaction, fail: (error: VaultError) => void) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;

      try {
        tx = this.database.transaction(stores, 'readwrite');
      } catch {
        reject(new VaultError('unavailable'));

        return;
      }
      let failure: VaultError | undefined;

      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(failure ?? new VaultError(tx.error?.name === 'QuotaExceededError' ? 'quota' : 'unavailable'));
      const fail = (error: VaultError) => {
        failure = error;
        tx.abort();
      };

      try {
        work(tx, fail);
      } catch {
        fail(new VaultError('corrupt'));
      }
    });
  }
}
