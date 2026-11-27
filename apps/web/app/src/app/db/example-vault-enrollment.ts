import { replicaId, createPinMethodId, createPrfCredential, deviceCustodyContext } from '@visomi-stack/web-frontend-db';
import { VaultError, type KeyDomain, type VaultUnlock, type WrappingContext } from '@visomi-stack/shared-db';

import type { ClientDatabase } from '../shared/db/database';
import { listVaultPasskeyIds } from '../auth/passkeys/passkeys';
import type { AuthHttp } from '../auth/shared/http';
import { browserPrfUnlock, openVaultDevice } from '../shared/vault/local-unlock';
import type { VaultSession } from '../shared/vault/vault-session';

import type { rosterSchema } from './example-contracts';

export async function openExampleDevice(options: {
  view: Window;
  key: KeyDomain;
  ownerId: string;
  rpId: string;
  signal: AbortSignal;
  existing?: WrappingContext;
  pin?: Uint8Array;
  initialKey?: Uint8Array;
  enrolled: boolean;
  backedSample: boolean;
  auth: AuthHttp;
  vault: VaultSession;
  current: () => void;
}) {
  const { view, key, ownerId, rpId, signal, existing, pin, enrolled, backedSample, auth, vault, current } = options;
  let binding = existing;
  let evaluated: VaultUnlock | undefined;

  try {
    if (!binding) {
      const context = {
        key,
        ownerId,
        deviceId: view.crypto.randomUUID(),
        method: pin ? 'pin-argon2id' : 'passkey-prf',
        origin: view.location.origin,
      } satisfies Omit<WrappingContext, 'methodId'>;

      if (backedSample && !pin) {
        const selected = await registeredVaultMethod(view, rpId, context, auth, signal);

        binding = selected.binding;
        evaluated = selected.unlock;
      } else if (pin) {
        binding = { ...context, methodId: createPinMethodId(view.crypto) };
      } else {
        const methodId = await createPrfCredential(
          { origin: view.location.origin, rpId, credentials: view.navigator.credentials, crypto: view.crypto },
          signal,
        );

        binding = { ...context, methodId };
      }

      current();
    }

    if ((binding.method === 'pin-argon2id') !== Boolean(pin)) {
      throw new VaultError(pin ? 'pin-invalid' : 'unsupported-prf');
    }

    const custodyExists = await vault.localBinding(deviceCustodyContext(binding).key);

    current();

    if (!custodyExists && enrolled) {
      throw new VaultError('recovery-required');
    }

    const provision = custodyExists ? (backedSample && !enrolled ? 'resume' : false) : true;
    const custody = await openVaultDevice(vault, binding, rpId, {
      initialize: !existing,
      initialKey: options.initialKey,
      provision,
      pin,
      combinePrf: backedSample,
      evaluated,
      signal,
      current,
    });

    return { binding, custody };
  } catch (error) {
    if (binding && backedSample && !enrolled && !signal.aborted) {
      vault.lockContext(binding);
    }

    throw error;
  } finally {
    evaluated?.cancel();
  }
}

export async function registeredVaultMethod(
  view: Window,
  rpId: string,
  context: Omit<WrappingContext, 'methodId'>,
  auth: AuthHttp,
  signal: AbortSignal,
) {
  const { credentialIds } = await listVaultPasskeyIds(auth, signal);

  signal.throwIfAborted();

  const selected = await browserPrfUnlock(view, rpId).forRegisteredDevice(context, credentialIds, signal);

  try {
    const active = await listVaultPasskeyIds(auth, signal);

    signal.throwIfAborted();

    if (!active.credentialIds.includes(selected.binding.methodId)) {
      throw new VaultError('passkey-not-registered');
    }

    return selected;
  } catch (error) {
    selected.unlock.cancel();

    throw error;
  }
}

/** Install only after verifying the recipient delivery and the independent approver pin. */
export async function installApprovedKey(options: {
  database: ClientDatabase;
  vault: VaultSession;
  context: WrappingContext;
  signal: AbortSignal;
  backed: boolean;
  roster: () => Promise<ReturnType<typeof rosterSchema.parse>>;
  install: () => Promise<void>;
  epoch: number;
}) {
  const { database, vault, context, signal, backed, roster, install, epoch } = options;
  const storage = await database.replica(context.ownerId, signal);
  const id = replicaId(context.ownerId, context.key, context.key.scope);

  try {
    const installed = await vault.localBinding(context.key);

    if (installed) {
      const registry = await roster();
      const previouslyVerified = await storage.hasVerifiedControl(id);

      if (
        !backed ||
        registry.devices.some((device) => device.id === installed.deviceId) ||
        !registry.devices.some(
          (device) => device.id === context.deviceId && device.ownerId === context.ownerId && !device.revokedAt,
        ) ||
        previouslyVerified
      ) {
        throw new VaultError('revision-conflict');
      }

      const local = await database.vault(context.ownerId, signal);

      try {
        await local.discardUnusedBinding(installed);
      } finally {
        local.close();
      }
    }

    signal.throwIfAborted();

    await install();

    await storage.advanceControl(id, {
      generation: context.key.generation,
      epoch,
    });
  } finally {
    storage.close();
  }
}
