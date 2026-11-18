import Dexie, { type Table } from 'dexie';
import { VaultError, type DataEnvelope, type WrappedKey } from '@visomi-stack/shared-db';

import type { PendingWrite, ReplicaPin } from '../sync/replica';

export type StoredKey = { id: string; envelope: WrappedKey; used: number };
export type StoredUnit = { id: string; envelope: DataEnvelope };
type StoredOutbox = { value: PendingWrite; seen: boolean };

/** Dynamic mode prevents Dexie's automatic schema patching/version fallback from changing the native v1 format. */
export class VaultDatabase extends Dexie {
  constructor(ownerId: string, indexedDB: IDBFactory) {
    super(`visomi-vault:${ownerId}`, { indexedDB, cache: 'disabled', autoOpen: false });
  }

  get keys(): Table<StoredKey, string> {
    return this.table('keys');
  }

  get units(): Table<StoredUnit, string> {
    return this.table('units');
  }
}

export class ReplicaDatabase extends Dexie {
  constructor(ownerId: string, indexedDB: IDBFactory) {
    super(`visomi-sync:${ownerId}`, { indexedDB, cache: 'disabled', autoOpen: false });
  }

  get pins(): Table<ReplicaPin, string> {
    return this.table('pins');
  }

  get units(): Table<DataEnvelope, string> {
    return this.table('units');
  }

  get outbox(): Table<StoredOutbox, string> {
    return this.table('outbox');
  }
}

export function storageError(error: unknown): VaultError {
  if (error instanceof VaultError) {
    return error;
  }

  const name = (error as { name?: unknown } | null)?.name;

  return new VaultError(name === 'QuotaExceededError' ? 'quota' : 'unavailable');
}

function validate(database: IDBDatabase, stores: readonly string[], keyPath: string | null): void {
  if (
    database.version !== 1 ||
    JSON.stringify(Array.from(database.objectStoreNames).sort()) !== JSON.stringify([...stores].sort())
  ) {
    throw new VaultError('unavailable');
  }

  const tx = database.transaction([...stores], 'readonly');

  for (const name of stores) {
    const store = tx.objectStore(name);

    if (store.keyPath !== keyPath || store.autoIncrement || store.indexNames.length) {
      throw new VaultError('unavailable');
    }
  }
}

/** Create only an absent database. Validate existing/future formats without upgrading, deleting or resetting them. */
async function ensureNative(
  factory: IDBFactory,
  name: string,
  stores: readonly string[],
  keyPath: string | null,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 1);
    let blocked = false;

    request.onupgradeneeded = () => {
      for (const store of stores) {
        request.result.createObjectStore(store, keyPath === null ? undefined : { keyPath });
      }
    };
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => {
      blocked = true;
      reject(new VaultError('unavailable'));
    };
    request.onsuccess = () => {
      try {
        if (blocked) {
          throw new VaultError('unavailable');
        }

        validate(request.result, stores, keyPath);
        resolve();
      } catch (error) {
        reject(storageError(error));
      } finally {
        request.result.close();
      }
    };
  });
}

export async function openDatabase<T extends Dexie>(
  database: T,
  factory: IDBFactory,
  stores: readonly string[],
  keyPath: string | null,
): Promise<T> {
  let blocked = false;

  // Returning false stops Dexie's default handlers from logging account-bearing database names or reopening on use.
  database.on('blocked', () => {
    blocked = true;
    database.close();

    return false;
  });
  database.on('versionchange', () => {
    database.close();

    return false;
  });

  try {
    await ensureNative(factory, database.name, stores, keyPath);

    await database.open();

    if (blocked) {
      throw new VaultError('unavailable');
    }

    validate(database.backendDB(), stores, keyPath);

    return database;
  } catch (error) {
    database.close();

    throw storageError(error);
  }
}
