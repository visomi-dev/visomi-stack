import { PrfUnlock, replicaId } from '@visomi-stack/web-frontend-db';
import { VaultError, type WrappingContext, type KeyDomain, type VaultUnlock } from '@visomi-stack/shared-db';

import type { ClientDatabase } from '../db/database';

import type { VaultSession } from './vault-session';

export function browserPrfUnlock(view: Window, rpId: string): PrfUnlock {
  const { location, navigator, crypto } = view;

  return new PrfUnlock({ origin: location.origin, rpId, credentials: navigator.credentials, crypto });
}

export function devicePrfUnlock(view: Window | null, binding: WrappingContext, rpId: string, signal: AbortSignal) {
  if (!view?.isSecureContext || view.location.origin !== binding.origin) {
    throw new VaultError('origin-mismatch');
  }

  return browserPrfUnlock(view, rpId).forDevice(binding, signal);
}

/** Open the note and its signing identity under the same explicit gesture. */
export async function openVaultDevice(
  vault: VaultSession,
  binding: WrappingContext,
  rpId: string,
  options: {
    initialize?: boolean;
    provision?: boolean;
    pin?: Uint8Array;
    combinePrf?: boolean;
    evaluated?: VaultUnlock;
    signal: AbortSignal;
    current: () => void;
  },
) {
  const { pin, signal, current, evaluated } = options;
  const initialize = options.initialize ?? false;
  const provision = options.provision ?? false;

  if (!evaluated && (!options.combinePrf || pin || vault.isOpen(binding))) {
    await vault.connect(binding, rpId, initialize, pin);

    current();

    return vault.device(binding, rpId, provision, pin);
  }

  let unlock = evaluated;

  if (!unlock) {
    const requested = await vault.deviceUnlock(binding, rpId, signal);

    unlock = requested;
  }

  try {
    current();

    await vault.connect(binding, rpId, initialize, undefined, unlock);

    current();

    const custody = await vault.device(binding, rpId, provision, undefined, unlock);

    return custody;
  } catch (error) {
    current();
    vault.lockContext(binding);

    throw error;
  } finally {
    if (!evaluated) {
      unlock.cancel();
    }
  }
}

/** Transfer connection ownership only after local custody and persisted generation checks succeed. */
export async function openLocalVault(options: {
  vault: VaultSession;
  database: ClientDatabase;
  key: Omit<KeyDomain, 'generation'>;
  rpId: string;
  pin?: Uint8Array;
  /** Use only on an explicit unlock action. Passive resume requires already-open custody. */
  allowPasskey?: boolean;
  ownerId: string;
  signal: AbortSignal;
  current: () => void;
}) {
  const { vault, database, key, rpId, pin, allowPasskey, ownerId, signal, current } = options;
  const binding = await vault.localLatestBinding(key);

  current();

  if (
    !binding ||
    binding.ownerId !== ownerId ||
    (pin
      ? binding.method !== 'pin-argon2id'
      : !vault.isOpen(binding) && !(allowPasskey && binding.method === 'passkey-prf'))
  ) {
    throw new VaultError('recovery-required');
  }

  let storage: Awaited<ReturnType<ClientDatabase['replica']>> | undefined;

  try {
    const identity = await openVaultDevice(vault, binding, rpId, { pin, combinePrf: allowPasskey, signal, current });

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
