import { z } from 'zod';

import { localPinEnvelope, pinKeyBinding } from 'shared-crypto';

export const localUnlockRecord = z.strictObject({
  envelope: localPinEnvelope,
  consent: z.literal(true),
  failures: z.number().int().min(0).max(10),
  cooldownUntil: z.number().int().nonnegative(),
});
export type LocalUnlockRecord = z.infer<typeof localUnlockRecord>;

const partition = pinKeyBinding.pick({ ownerUserId: true, personalScopeId: true });

/** Local-only PIN custody. This database must never be included in cloud sync. */
export class UnlockStorage {
  constructor(
    private readonly indexedDb: IDBFactory,
    private readonly locks: LockManager,
  ) {}

  /** Hold this lock across the entire read/derive/update sequence, not just a write. */
  async exclusive<T>(ownerUserId: string, scopeId: string, operation: () => Promise<T>): Promise<T> {
    partition.parse({ ownerUserId, personalScopeId: scopeId });

    return await this.locks.request(`visomi-vault-unlock:${ownerUserId}:${scopeId}`, operation);
  }

  async read(ownerUserId: string, scopeId: string): Promise<LocalUnlockRecord | null> {
    partition.parse({ ownerUserId, personalScopeId: scopeId });

    return await this.transaction('readonly', async (store) => {
      const values = await this.request<unknown[]>(store.getAll());
      const records = values.map((value) => localUnlockRecord.parse(value));
      const matches = records.filter(
        (record) =>
          record.envelope.binding.ownerUserId === ownerUserId && record.envelope.binding.personalScopeId === scopeId,
      );

      if (matches.length > 1) {
        throw new Error('local_unlock_conflict');
      }

      return matches[0] ?? null;
    });
  }

  async replace(record: LocalUnlockRecord): Promise<void> {
    const value = localUnlockRecord.parse(record);
    const binding = value.envelope.binding;

    await this.transaction('readwrite', async (store) => {
      const values = await this.request<unknown[]>(store.getAll());

      for (const input of values) {
        const existing = localUnlockRecord.parse(input);
        const current = existing.envelope.binding;

        if (current.ownerUserId === binding.ownerUserId && current.personalScopeId === binding.personalScopeId) {
          store.delete([current.ownerUserId, current.personalScopeId, current.browserId]);
        }
      }

      store.put(value, [binding.ownerUserId, binding.personalScopeId, binding.browserId]);
    });
  }

  async remove(ownerUserId: string, scopeId: string): Promise<void> {
    partition.parse({ ownerUserId, personalScopeId: scopeId });
    await this.transaction('readwrite', async (store) => {
      const values = await this.request<unknown[]>(store.getAll());

      for (const input of values) {
        const record = localUnlockRecord.parse(input);
        const binding = record.envelope.binding;

        if (binding.ownerUserId === ownerUserId && binding.personalScopeId === scopeId) {
          store.delete([ownerUserId, scopeId, binding.browserId]);
        }
      }
    });
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.indexedDb.open('visomi-vault-unlock', 1);
      let failed = false;

      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('methods')) {
          request.result.createObjectStore('methods');
        }
      };
      request.onblocked = () => {
        failed = true;
        reject(new Error('local_unlock_storage_blocked'));
      };
      request.onerror = () => reject(new Error('local_unlock_storage_unavailable'));
      request.onsuccess = () => {
        const db = request.result;

        db.onversionchange = () => db.close();
        if (failed) {
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
      request.onerror = () => reject(new Error('local_unlock_storage_unavailable'));
    });
  }

  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await this.open();

    try {
      const tx = db.transaction('methods', mode);
      const finished = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(new Error('local_unlock_storage_unavailable'));
        tx.onerror = () => reject(new Error('local_unlock_storage_unavailable'));
      });

      // Observe both promises immediately so quota/request failures cannot escape as unhandled rejections.
      const action = operation(tx.objectStore('methods')).catch((error: unknown) => {
        try {
          tx.abort();
        } catch {
          // Completed or already aborted transactions cannot be aborted again.
        }

        throw error;
      });
      const result = await Promise.all([action, finished]);

      return result[0];
    } finally {
      db.close();
    }
  }
}
