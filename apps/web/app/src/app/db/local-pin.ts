import { replicaId, type DeviceCustody } from '@visomi-stack/web-frontend-db';
import { syntheticHybridPolicy, VaultError } from '@visomi-stack/shared-db';

import type { ClientDatabase } from './database';
import type { VaultSession } from './vault-session';
import type { ExampleTarget } from './example-private-resource';

/** Transfer connection ownership only after local custody and persisted generation checks succeed. */
export async function openLocalPin(options: {
  vault: VaultSession;
  database: ClientDatabase;
  target: ExampleTarget;
  rpId: string;
  pin: Uint8Array;
  ownerId: string;
  signal: AbortSignal;
  current: () => void;
}) {
  const { vault, database, target, rpId, pin, ownerId, signal, current } = options;
  const binding = await vault.localLatestBinding({
    product: syntheticHybridPolicy.product,
    domain: 'private-resources',
    scope: { kind: 'resource', tenantId: target.tenantId, groupId: null, resourceId: target.scopeId },
  });

  current();

  if (!binding || binding.method !== 'pin-argon2id' || binding.ownerId !== ownerId) {
    throw new VaultError('recovery-required');
  }

  let custody: DeviceCustody | undefined;
  let storage: Awaited<ReturnType<ClientDatabase['replica']>> | undefined;

  try {
    await vault.connect(binding, rpId, false, pin);

    current();

    const identity = await vault.device(binding, rpId, false, pin);

    custody = identity;
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

    return { binding, custody, storage, pinned };
  } catch (error) {
    storage?.close();
    custody?.lock();

    if (!signal.aborted) {
      vault.lock(false);
    }

    throw error;
  }
}
