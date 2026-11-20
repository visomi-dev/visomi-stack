import { DOCUMENT } from '@angular/common';
import { DestroyRef, InjectionToken, Service, inject } from '@angular/core';
import { VaultError } from '@visomi-stack/shared-db';

import { Session } from '../../auth/session/session';

export const VAULT_DATABASE_NAMESPACE = new InjectionToken<string>('VaultDatabaseNamespace');

/** Lazy browser database facade. Consumers own their connections; no plaintext or raw keys enter this service. */
@Service()
export class ClientDatabase {
  private readonly document = inject(DOCUMENT);
  private readonly session = inject(Session);
  private readonly destroyRef = inject(DestroyRef);
  private readonly namespace = inject(VAULT_DATABASE_NAMESPACE, { optional: true });

  vault(ownerId: string, signal?: AbortSignal) {
    const namespace = this.namespace;

    return this.open(
      ownerId,
      (sdk, factory) =>
        namespace
          ? sdk.IndexedDbVaultStorage.open(factory, namespace + ':' + ownerId, { localPasskeys: true })
          : sdk.IndexedDbVaultStorage.open(factory, ownerId),
      signal,
    );
  }

  replica(ownerId: string, signal?: AbortSignal) {
    return this.open(ownerId, (sdk, factory) => sdk.IndexedDbReplicaStorage.open(factory, ownerId), signal);
  }

  private async open<T extends { close(): void }>(
    ownerId: string,
    create: (sdk: typeof import('@visomi-stack/web-frontend-db/storage'), factory: IDBFactory) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const factory = this.document.defaultView?.indexedDB;
    const version = this.session.operationVersion();
    const current = () =>
      !this.destroyRef.destroyed &&
      !signal?.aborted &&
      this.session.full() &&
      this.session.user()?.id === ownerId &&
      this.session.operationVersion() === version;

    if (!factory || !current()) {
      throw new VaultError('unavailable');
    }

    const sdk = await import('@visomi-stack/web-frontend-db/storage');

    if (!current()) {
      throw new VaultError('stale-operation');
    }

    const storage = await create(sdk, factory);

    if (!current()) {
      storage.close();

      throw new VaultError('stale-operation');
    }

    return storage;
  }
}
