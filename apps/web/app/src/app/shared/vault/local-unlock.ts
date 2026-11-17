import { replicaId } from '@visomi-stack/web-frontend-db';
import { VaultError, type KeyDomain } from '@visomi-stack/shared-db';

import type { ClientDatabase } from '../db/database';

import type { VaultSession } from './vault-session';

/** Transfer connection ownership only after local custody and persisted generation checks succeed. */
export async function openLocalVault(options: {
  vault: VaultSession;
  database: ClientDatabase;
  key: Omit<KeyDomain, 'generation'>;
  rpId: string;
  pin?: Uint8Array;
  ownerId: string;
  signal: AbortSignal;
  current: () => void;
}) {
  const { vault, database, key, rpId, pin, ownerId, signal, current } = options;
  const binding = await vault.localLatestBinding(key);

  current();

  if (!binding || binding.ownerId !== ownerId || (pin ? binding.method !== 'pin-argon2id' : !vault.isOpen(binding))) {
    throw new VaultError('recovery-required');
  }

  let storage: Awaited<ReturnType<ClientDatabase['replica']>> | undefined;

  try {
    await vault.connect(binding, rpId, false, pin);

    current();

    const identity = await vault.device(binding, rpId, false, pin);

    current();

    const connection = await database.replica(ownerId, signal);

    storage = connection;
    current();
    const id = replicaId(ownerId, binding.key, binding.key.scope);
    const pinned = await storage.pin(id);

    current();

    if (pinned.generation > binding.key.generation) {
      throw new VaultError('corrupt');
    }

    return { binding, custody: identity, storage, pinned };
  } catch (error) {
    storage?.close();

    if (!signal.aborted) {
      vault.lockContext(binding);
    }

    throw error;
  }
}
