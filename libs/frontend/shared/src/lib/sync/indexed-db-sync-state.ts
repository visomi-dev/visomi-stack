import { z } from 'zod';

import { BrowserSyncAdapter, createOpaqueSyncHttpTransport, syncStateSchema } from 'shared-crypto';
import type { OpaqueSyncTransport, OpaqueSyncTransportOptions, SyncState, SyncStateStore } from 'shared-crypto';

export function createPersistentBrowserSyncHttp(
  ownerUserId: string,
  options: OpaqueSyncTransportOptions,
  indexedDb: IDBFactory,
  locks: LockManager,
): BrowserSyncAdapter {
  return createPersistentBrowserSync(
    ownerUserId,
    options.workspaceId,
    createOpaqueSyncHttpTransport(options),
    indexedDb,
    locks,
  );
}

export function createPersistentBrowserSync(
  ownerUserId: string,
  workspaceId: string,
  transport: OpaqueSyncTransport,
  indexedDb: IDBFactory,
  locks: LockManager,
): BrowserSyncAdapter {
  return new BrowserSyncAdapter(
    workspaceId,
    transport,
    new IndexedDbSyncStateStore(indexedDb, locks, ownerUserId, workspaceId),
  );
}

const recordSchema = z
  .strictObject({
    ownerUserId: z.string().min(1).max(256),
    workspaceId: z.string().min(1).max(256),
    state: syncStateSchema,
  })
  .refine((value) => value.workspaceId === value.state.cursor.workspaceId);

/** Separate encrypted sync state; never stores a PIN envelope, plaintext or vault key. */
export class IndexedDbSyncStateStore implements SyncStateStore {
  constructor(
    private readonly indexedDb: IDBFactory,
    private readonly locks: LockManager,
    private readonly ownerUserId: string,
    private readonly workspaceId: string,
  ) {
    recordSchema.parse({
      ownerUserId,
      workspaceId,
      state: { cursor: { workspaceId, value: 0 }, queue: [], tombstones: [] },
    });
  }

  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    return await this.locks.request(
      `visomi-encrypted-sync:${JSON.stringify([this.ownerUserId, this.workspaceId])}`,
      operation,
    );
  }

  async load(): Promise<SyncState | undefined> {
    return await this.transaction('readonly', async (store) => {
      const input: unknown = await this.request(store.get([this.ownerUserId, this.workspaceId]));

      if (input === undefined) return undefined;
      const record = recordSchema.parse(input);

      if (record.ownerUserId !== this.ownerUserId || record.workspaceId !== this.workspaceId) {
        throw new Error('sync_storage_partition_mismatch');
      }

      return record.state;
    });
  }

  async save(state: SyncState): Promise<void> {
    const record = recordSchema.parse({ ownerUserId: this.ownerUserId, workspaceId: this.workspaceId, state });

    await this.transaction('readwrite', async (store) => {
      const input: unknown = await this.request(store.get([this.ownerUserId, this.workspaceId]));

      if (input !== undefined && recordSchema.parse(input).state.cursor.value > record.state.cursor.value) {
        throw new Error('sync_storage_cursor_regression');
      }

      store.put(record, [this.ownerUserId, this.workspaceId]);
    });
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.indexedDb.open('visomi-encrypted-sync', 1);
      let blocked = false;

      request.onupgradeneeded = () => request.result.createObjectStore('states');
      request.onerror = () => reject(new Error('sync_storage_unavailable'));
      request.onblocked = () => {
        blocked = true;
        reject(new Error('sync_storage_blocked'));
      };
      request.onsuccess = () => {
        const db = request.result;

        db.onversionchange = () => db.close();
        if (blocked) {
          db.close();

          return;
        }

        resolve(db);
      };
    });
  }

  private request<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('sync_storage_unavailable'));
    });
  }

  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await this.open();

    try {
      const tx = db.transaction('states', mode);
      const completed = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(new Error('sync_storage_unavailable'));
        tx.onerror = () => reject(new Error('sync_storage_unavailable'));
      });
      const pending = operation(tx.objectStore('states')).catch((error: unknown) => {
        try {
          tx.abort();
        } catch {
          // Already completed/aborted transactions cannot be aborted a second time.
        }

        throw error;
      });
      const [result] = await Promise.all([pending, completed]);

      return result;
    } finally {
      db.close();
    }
  }
}
