import { parseEncryptedEnvelope, serializeEncryptedEnvelope } from 'shared-crypto';
import type { EncryptedEnvelope, ProjectionScope } from 'shared-crypto';

/** Ciphertext-only archive. Replayed batches are idempotent and revision substitution fails closed. */
export class IndexedDbProjections {
  constructor(
    private readonly factory: IDBFactory,
    private readonly scope: ProjectionScope,
  ) {}

  async list(): Promise<EncryptedEnvelope[]> {
    return await this.transaction('readonly', async (store) => {
      const records: unknown[] = await this.request(
        store.getAll(IDBKeyRange.bound(this.partition(), [...this.partition(), []])),
      );

      return records.map((record) => this.validate(record));
    });
  }

  async apply(envelopes: ReadonlyArray<EncryptedEnvelope>, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const inputs = envelopes.map((envelope) => this.validate(envelope));

    await this.transaction('readwrite', async (store) => {
      for (const envelope of inputs) {
        signal?.throwIfAborted();
        const key = [...this.partition(), envelope.envelopeId, envelope.revision];
        const previous: unknown = await this.request(store.get(key));

        if (previous !== undefined && serializeEncryptedEnvelope(previous) !== serializeEncryptedEnvelope(envelope))
          throw new Error('sync_projection_revision_conflict');
        if (
          previous === undefined &&
          (await this.request(store.count(IDBKeyRange.bound(this.partition(), [...this.partition(), []])))) >= 10_000
        )
          throw new Error('sync_projection_capacity');
        store.put(envelope, key);
      }
      signal?.throwIfAborted();
    });
  }

  private validate(input: unknown): EncryptedEnvelope {
    const envelope = parseEncryptedEnvelope(input);

    if (
      envelope.kind !== 'sync-object' ||
      envelope.recordType !== 'projection' ||
      envelope.workspaceId !== this.scope.workspaceId ||
      envelope.associatedData['ownerUserId'] !== this.scope.ownerUserId ||
      envelope.associatedData['accountId'] !== this.scope.accountId
    )
      throw new Error('sync_projection_scope_mismatch');

    return envelope;
  }

  private partition(): string[] {
    return [this.scope.ownerUserId, this.scope.accountId, this.scope.workspaceId];
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open('visomi-encrypted-projections', 1);
      let blocked = false;

      request.onupgradeneeded = () => request.result.createObjectStore('envelopes');
      request.onerror = () => reject(new Error('sync_projection_storage_unavailable'));
      request.onblocked = () => {
        blocked = true;
        reject(new Error('sync_projection_storage_blocked'));
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
      request.onerror = () => reject(new Error('sync_projection_storage_unavailable'));
    });
  }

  private async transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await this.open();

    try {
      const tx = db.transaction('envelopes', mode);
      const completed = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(new Error('sync_projection_storage_unavailable'));
        tx.onerror = () => reject(new Error('sync_projection_storage_unavailable'));
      });
      const operation = action(tx.objectStore('envelopes')).catch((error: unknown) => {
        try {
          tx.abort();
        } catch {
          /* A completed transaction cannot be aborted twice. */
        }
        throw error;
      });
      const [result] = await Promise.all([operation, completed]);

      return result;
    } finally {
      db.close();
    }
  }
}
