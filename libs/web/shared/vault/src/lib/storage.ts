import { z } from 'zod';
import {
  dataEnvelopeSchema,
  wrappedKeySchema,
  VaultError,
  type DataEnvelope,
  type VaultStorage,
  type WrappedKey,
} from '@visomi-stack/shared-persistence';

const storedKeySchema = z.strictObject({
  id: z.string(),
  envelope: wrappedKeySchema,
  used: z.number().int().min(0).max(1_048_576),
});
const storedUnitSchema = z.strictObject({ id: z.string(), envelope: dataEnvelopeSchema });

type StoredKey = z.infer<typeof storedKeySchema>;
type StoredUnit = z.infer<typeof storedUnitSchema>;

function storageError(error: unknown): VaultError {
  return new VaultError(error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota' : 'unavailable');
}

/** Resolves only after transaction commit; request success alone is not durability. */
export class IndexedDbVaultStorage implements VaultStorage {
  private constructor(private readonly database: IDBDatabase) {}

  static async open(factory: IDBFactory | undefined, name: string): Promise<IndexedDbVaultStorage> {
    if (!factory) {
      throw new VaultError('unavailable');
    }

    return new Promise((resolve, reject) => {
      const request = factory.open(`visomi-vault:${name}`, 1);
      let blocked = false;

      request.onupgradeneeded = () => {
        request.result.createObjectStore('keys', { keyPath: 'id' });
        request.result.createObjectStore('units', { keyPath: 'id' });
      };
      request.onblocked = () => {
        blocked = true;
        reject(new VaultError('unavailable'));
      };
      request.onerror = () => reject(storageError(request.error));
      request.onsuccess = () => {
        if (blocked) {
          request.result.close();

          return;
        }

        request.result.onversionchange = () => request.result.close();
        resolve(new IndexedDbVaultStorage(request.result));
      };
    });
  }

  async getKey(id: string): Promise<WrappedKey | undefined> {
    const value = await this.read<StoredKey>('keys', id);

    if (!value) {
      return undefined;
    }

    const result = storedKeySchema.safeParse(value);

    if (!result.success || result.data.id !== id) {
      throw new VaultError('corrupt');
    }

    return result.data.envelope;
  }

  async putKey(id: string, envelope: WrappedKey, exhausted = false): Promise<void> {
    const result = wrappedKeySchema.safeParse(envelope);

    if (!result.success) {
      throw new VaultError('corrupt');
    }

    await this.change<StoredKey>('keys', id, (current) => {
      if (current) {
        throw new VaultError('revision-conflict');
      }

      return { id, envelope: result.data, used: exhausted ? 1_048_576 : 0 };
    });
  }

  async reserveEncryption(id: string, limit: number): Promise<void> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_048_576) {
      throw new VaultError('quota');
    }

    await this.change<StoredKey>('keys', id, (value) => {
      const parsed = storedKeySchema.safeParse(value);

      if (!parsed.success || parsed.data.id !== id) {
        throw new VaultError('corrupt');
      }

      if (parsed.data.used >= limit) {
        throw new VaultError('quota');
      }

      return { id, envelope: parsed.data.envelope, used: parsed.data.used + 1 };
    });
  }

  async getUnit(id: string): Promise<DataEnvelope | undefined> {
    const value = await this.read<StoredUnit>('units', id);

    if (!value) {
      return undefined;
    }

    const result = storedUnitSchema.safeParse(value);

    if (!result.success || result.data.id !== id) {
      throw new VaultError('corrupt');
    }

    return result.data.envelope;
  }

  async putUnit(id: string, expectedRevision: number, envelope: DataEnvelope): Promise<void> {
    const parsed = dataEnvelopeSchema.safeParse(envelope);

    if (
      !parsed.success ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      parsed.data.context.revision !== expectedRevision + 1
    ) {
      throw new VaultError('corrupt');
    }

    await this.change<StoredUnit>('units', id, (current) => {
      if (current && (!storedUnitSchema.safeParse(current).success || current.id !== id)) {
        throw new VaultError('corrupt');
      }

      if (
        (current?.envelope.context.revision ?? 0) !== expectedRevision ||
        (current && current.envelope.context.key.generation > parsed.data.context.key.generation)
      ) {
        throw new VaultError('revision-conflict');
      }

      return { id, envelope: parsed.data };
    });
  }

  async deleteKey(id: string): Promise<void> {
    await this.change<StoredKey>('keys', id, () => undefined);
  }

  async restore(
    key: { id: string; envelope: WrappedKey },
    units: readonly { id: string; envelope: DataEnvelope }[],
  ): Promise<void> {
    const parsedKey = storedKeySchema.safeParse({ ...key, used: 1_048_576 });
    const parsedUnits = z.array(storedUnitSchema).max(100).safeParse(units);

    if (!parsedKey.success || !parsedUnits.success || new Set(units.map((unit) => unit.id)).size !== units.length) {
      throw new VaultError('corrupt');
    }

    await new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction;

      try {
        tx = this.database.transaction(['keys', 'units'], 'readwrite');
      } catch {
        reject(new VaultError('unavailable'));

        return;
      }
      let failure: VaultError | undefined;

      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(failure ?? storageError(tx.error));
      const keys = tx.objectStore('keys');
      const request = keys.get(key.id);
      const fail = () => {
        failure = new VaultError('revision-conflict');
        tx.abort();
      };

      request.onsuccess = () => {
        if (request.result !== undefined) {
          fail();

          return;
        }

        const store = tx.objectStore('units');
        let index = 0;
        const apply = () => {
          const unit = parsedUnits.data[index++];

          if (!unit) {
            keys.put(parsedKey.data);

            return;
          }

          const existing = store.get(unit.id);

          existing.onsuccess = () => {
            if (existing.result !== undefined) {
              fail();

              return;
            }

            store.put(unit);
            apply();
          };
        };

        apply();
      };
    });
  }

  close(): void {
    this.database.close();
  }

  private read<T>(store: string, id: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;

      try {
        transaction = this.database.transaction(store, 'readonly');
      } catch (error) {
        reject(storageError(error));

        return;
      }

      const request = transaction.objectStore(store).get(id);
      let value: T | undefined;

      request.onsuccess = () => {
        value = request.result as T | undefined;
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = transaction.onerror = () => reject(storageError(transaction.error));
    });
  }

  private change<T>(store: string, id: string, update: (current: T | undefined) => T | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;

      try {
        transaction = this.database.transaction(store, 'readwrite');
      } catch (error) {
        reject(storageError(error));

        return;
      }

      const objectStore = transaction.objectStore(store);
      const request = objectStore.get(id);
      let failure: unknown;

      request.onsuccess = () => {
        try {
          const value = update(request.result as T | undefined);

          if (value === undefined) {
            objectStore.delete(id);
          } else {
            objectStore.put(value);
          }
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(failure instanceof VaultError ? failure : storageError(transaction.error));
    });
  }
}
