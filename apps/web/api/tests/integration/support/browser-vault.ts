import type { DeviceProof, KeyDomain } from '@visomi-stack/shared-db';

import type { FixtureHost, ProtocolBrowser } from './browser-server';

/** Opens separate local storage and custody in each synthetic browser profile. */
export function initializeBrowserVault(
  client: ProtocolBrowser,
  options: { key: KeyDomain; ownerId: string; csrf: string; path: string; bootstrap: boolean; usePin: boolean },
) {
  return client.page.evaluate(async ({ key, ownerId, csrf, path, bootstrap, usePin }) => {
    const host = globalThis as FixtureHost;
    const { api, contracts } = host.modules;
    const environment = {
      origin: location.origin,
      rpId: location.hostname,
      credentials: navigator.credentials,
      crypto,
    };
    const createPasskey = (signal = new AbortController().signal) => api.createPrfCredential(environment, signal);
    const resultCode = (error: unknown) => (error instanceof contracts.VaultError ? error.code : 'unexpected');

    if (usePin) {
      const capability = await createPasskey().then(() => 'available', resultCode);

      if (capability !== 'unsupported-prf') {
        throw new Error('synthetic_prf_expected_unavailable');
      }
    } else {
      const controller = new AbortController();
      const pending = createPasskey(controller.signal).then(() => 'available', resultCode);

      controller.abort();
      const cancelled = await pending;

      if (cancelled !== 'cancelled') {
        throw new Error('synthetic_prf_expected_cancelled');
      }
    }

    const methodId = await (usePin ? api.createPinMethodId(crypto) : createPasskey());
    const binding = contracts.wrappingContextSchema.parse({
      key,
      ownerId,
      deviceId: crypto.randomUUID(),
      method: usePin ? api.pinMethod : 'passkey-prf',
      methodId,
      origin: location.origin,
    });
    let correctPin = true;
    const unlocker = () =>
      usePin
        ? new api.PinUnlock(async () => new TextEncoder().encode(correctPin ? '406207' : '406208'))
        : new api.PrfUnlock(environment);
    const storage = await api.IndexedDbVaultStorage.open(indexedDB, ownerId);
    const vault = new api.BrowserVault(ownerId, storage, unlocker(), new api.WebCryptoCipher(crypto));

    if (bootstrap) {
      await vault.initialize(binding);
    }

    const custodyStorage = await api.IndexedDbVaultStorage.open(indexedDB, ownerId);
    const custody = new api.DeviceCustody(custodyStorage, binding, unlocker(), crypto);

    await custody.unlock(true);

    const keys = await custody.publicKeys();
    const request = await fetch(`${path}/devices/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ deviceId: binding.deviceId, keys }),
    });

    if (!request.ok) {
      throw new Error('synthetic_device_request_failed');
    }

    const raw = await request.json();
    const challenge = await custody.prove(contracts.deviceChallengeSchema.parse(raw));

    if (bootstrap) {
      const registered = await fetch(`${path}/devices/bootstrap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify(challenge),
      });

      if (!registered.ok) {
        throw new Error('synthetic_bootstrap_failed');
      }
    }

    const replicaStorage = await api.IndexedDbReplicaStorage.open(indexedDB, ownerId);

    host.client = { binding, vault, custody, challenge, storage: replicaStorage, path, csrf };

    if (usePin) {
      host.client.enterPin = (correct) => {
        correctPin = correct;
      };
    }

    const fingerprint = await new api.WebCryptoDevices(crypto).fingerprint(challenge);

    return { proof: challenge, fingerprint, method: binding.method };
  }, options);
}

export function approveBrowserRecipient(owner: ProtocolBrowser, proof: DeviceProof, verifiedFingerprint: string) {
  return owner.page.evaluate(
    async ({ proof, verifiedFingerprint }: { proof: DeviceProof; verifiedFingerprint: string }) => {
      const host = globalThis as FixtureHost;
      const { api, contracts } = host.modules;
      const client = host.client;
      const devices = new api.WebCryptoDevices(crypto);
      const fingerprint = await devices.fingerprint(proof);

      if (fingerprint !== verifiedFingerprint) {
        throw new Error('synthetic_recipient_fingerprint_mismatch');
      }

      const binding = {
        key: proof.key,
        ownerId: proof.ownerId,
        deviceId: proof.deviceId,
        requestId: proof.requestId,
        challenge: proof.challenge,
        fingerprint,
        encryption: proof.keys.encryption,
      };
      const delivery = await client.vault.deliver(binding, devices);
      const body = { proof: contracts.deviceProofSchema.parse(proof), delivery };
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
      const authorization = await client.custody.sign({
        key: proof.key,
        deviceId: client.binding.deviceId,
        operationId: crypto.randomUUID(),
        epoch: 1,
        action: 'approve',
        bodyHash: api.encodeBytes(new Uint8Array(digest)),
      });
      const approved = await fetch(`${client.path}/devices/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': client.csrf },
        body: JSON.stringify({ ...body, authorization }),
      });

      if (!approved.ok) {
        throw new Error('synthetic_approval_failed');
      }

      const keys = await client.custody.publicKeys();

      const pin = { deviceId: client.binding.deviceId, signing: keys.signing };
      const signer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(pin)));

      return { pin, fingerprint: api.encodeBytes(new Uint8Array(signer)) };
    },
    { proof, verifiedFingerprint },
  );
}

export function installBrowserDelivery(member: ProtocolBrowser, verifiedFingerprint: string) {
  return member.page.evaluate(async (verifiedFingerprint) => {
    const {
      client,
      modules: { api, contracts },
    } = globalThis as FixtureHost;
    const response = await fetch(`${client.path}/devices/${client.binding.deviceId}/delivery`);
    const roster = await fetch(`${client.path}/devices`);

    if (!response.ok || !roster.ok) {
      throw new Error('synthetic_delivery_failed');
    }

    const delivery = await response.json();
    const raw = contracts.approvedDeliverySchema.parse(delivery);
    const rosterBody: { devices: { id: string; signing: string }[] } = await roster.json();
    const signer = rosterBody.devices.find(({ id }) => id === raw.authorization.deviceId);
    const pin = contracts.signingPinSchema.parse({ deviceId: signer?.id, signing: signer?.signing });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(pin)));

    if (api.encodeBytes(new Uint8Array(digest)) !== verifiedFingerprint) {
      throw new Error('synthetic_approver_fingerprint_mismatch');
    }

    const challenge = client.challenge;
    const fingerprint = await new api.WebCryptoDevices(crypto).fingerprint(challenge);
    const expected = {
      key: challenge.key,
      ownerId: challenge.ownerId,
      deviceId: challenge.deviceId,
      requestId: challenge.requestId,
      challenge: challenge.challenge,
      fingerprint,
      encryption: challenge.keys.encryption,
    };
    const key = await client.custody.open(expected, raw, pin);

    try {
      await client.vault.install(client.binding, key);
    } finally {
      key.fill(0);
    }

    return raw.authorization.epoch + 1;
  }, verifiedFingerprint);
}

export function connectBrowserReplica(browser: ProtocolBrowser, minimumEpoch: number) {
  return browser.page.evaluate((minimumEpoch) => {
    const host = globalThis as FixtureHost;
    const {
      client,
      modules: { api },
    } = host;
    const id = api.replicaId(client.binding.ownerId, client.binding.key, client.binding.key.scope);
    const transport = async (path: string, body: unknown, signal: AbortSignal) => {
      const response = await fetch(`${client.path}/sync/${path}`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', 'x-csrf-token': client.csrf },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error('synthetic_sync_rejected');
      }

      const result = await response.json();

      return result;
    };

    client.replica = new api.SyncReplica(
      id,
      client.binding.key,
      client.binding.key.scope,
      client.storage,
      {
        pull: (head, signal) => transport('pull', { protocol: 1, head }, signal),
        push: (value, signal) => transport('push', value, signal),
      },
      crypto,
      async (envelope) => {
        const clear = await client.vault.decrypt(envelope.context, envelope);

        clear.fill(0);
      },
      minimumEpoch,
    );
  }, minimumEpoch);
}
