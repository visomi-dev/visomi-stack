import { describe, expect, it } from 'vitest';

import { browser, prepare, vector, type FixtureWindow } from './support/browser';

describe('actual Chromium PRF device identity custody', () => {
  it('persists identity separately from resource keys and restores signing/delivery authority only after explicit PRF unlock', async () => {
    const context = await browser.newContext();

    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);

      await cdp.send('WebAuthn.enable');

      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
          hasPrf: true,
        },
      });

      await prepare(page);

      const result = await page.evaluate(
        async ({ vector }) => {
          const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
          const environment = {
            origin: location.origin,
            rpId: location.hostname,
            credentials: navigator.credentials,
            crypto,
          };
          const methodId = await api.createPrfCredential(environment, new AbortController().signal);
          const binding = { ...vector.wrapped.context, origin: location.origin, methodId };
          const name = crypto.randomUUID();
          const storage = await api.IndexedDbVaultStorage.open(indexedDB, name);
          const custody = new api.DeviceCustody(storage, binding, new api.PrfUnlock(environment), crypto);

          await custody.unlock(true);

          const firstKeys = await custody.publicKeys();
          const independent = api.deviceCustodyContext(binding);
          const wrapped = await storage.getKey(contracts.keyDomainId(binding.ownerId, independent.key));
          const shared = await storage.getKey(contracts.keyDomainId(binding.ownerId, binding.key));
          const encrypted = await storage.getUnit(
            contracts.vaultUnitId(binding.ownerId, {
              ...vector.data.context,
              key: independent.key,
              target: independent.key.scope,
              objectId: binding.deviceId,
            }),
          );

          custody.close();
          const reopened = await api.IndexedDbVaultStorage.open(indexedDB, name);
          const restored = new api.DeviceCustody(reopened, binding, new api.PrfUnlock(environment), crypto);
          let locked = '';

          try {
            await restored.publicKeys();
          } catch (error) {
            locked = (error as { code: string }).code;
          }

          await restored.unlock();

          const keys = await restored.publicKeys();
          const challenge = {
            format: 'visomi.device-enrollment' as const,
            version: 1 as const,
            key: binding.key,
            ownerId: binding.ownerId,
            deviceId: binding.deviceId,
            requestId: crypto.randomUUID(),
            challenge: api.encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            keys,
          };
          const proof = await restored.prove(challenge);
          const devices = new api.WebCryptoDevices(crypto);
          const valid = await devices.verify(proof);
          const fingerprint = await devices.fingerprint(challenge);
          const recipient = {
            key: binding.key,
            ownerId: binding.ownerId,
            deviceId: binding.deviceId,
            requestId: challenge.requestId,
            challenge: challenge.challenge,
            fingerprint,
            encryption: keys.encryption,
          };
          const delivery = await devices.seal(new Uint8Array(32).fill(7), recipient);
          const bodyHash = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(JSON.stringify({ proof, delivery })),
          );
          const authorization = await restored.sign({
            key: binding.key,
            deviceId: binding.deviceId,
            operationId: crypto.randomUUID(),
            epoch: 1,
            action: 'approve',
            bodyHash: api.encodeBytes(new Uint8Array(bodyHash)),
          });
          const approved = contracts.approvedDeliverySchema.parse({
            format: 'visomi.approved-device-key',
            version: 1,
            delivery,
            authorization,
            witness: { kind: 'enrollment', proof, delivery },
          });
          const pin = { deviceId: binding.deviceId, signing: keys.signing };
          const raw = await restored.open(recipient, approved, pin);
          const delivered = raw.length === 32 && raw.every((value) => value === 7);

          raw.fill(0);
          restored.lock();
          let afterLock = '';

          try {
            await restored.open(recipient, approved, pin);
          } catch (error) {
            afterLock = (error as { code: string }).code;
          }
          restored.close();

          return {
            separateDomain: independent.key.domain,
            resourceWrapperAbsent: shared === undefined,
            custodyWrapperPresent: Boolean(wrapped),
            encryptedIdentity: encrypted?.format,
            locked,
            keysMatch: JSON.stringify(firstKeys) === JSON.stringify(keys),
            valid,
            delivered,
            afterLock,
          };
        },
        { vector },
      );

      expect(result).toEqual({
        separateDomain: 'device-custody',
        resourceWrapperAbsent: true,
        custodyWrapperPresent: true,
        encryptedIdentity: 'visomi.data',
        locked: 'locked',
        keysMatch: true,
        valid: true,
        delivered: true,
        afterLock: 'locked',
      });
    } finally {
      await context.close();
    }
  });
});

it('rejects a delayed previous identity unlock without replacing a newer unlocked identity', async () => {
  const page = await browser.newPage();

  try {
    await prepare(page);

    const result = await page.evaluate(
      async ({ vector }) => {
        const { api } = (globalThis as FixtureWindow).fixtureModules;
        const binding = { ...vector.wrapped.context, method: 'passkey-prf' as const };
        const storage = await api.IndexedDbVaultStorage.open(indexedDB, binding.ownerId);
        const custody = new api.DeviceCustody(
          storage,
          binding,
          {
            secret: async () => new Uint8Array(32).fill(7),
            cancel: () => undefined,
          },
          crypto,
        );

        await custody.unlock(true);

        const before = await custody.publicKeys();
        const original = api.BrowserVault.prototype.unlock;
        let complete!: () => void;
        let first = true;

        api.BrowserVault.prototype.unlock = function (context) {
          if (first) {
            first = false;

            return new Promise<void>((resolve) => {
              complete = resolve;
            });
          }

          return original.call(this, context);
        };

        try {
          const old = custody.unlock().then(
            () => 'accepted',
            (error: { code: string }) => error.code,
          );

          custody.lock();

          await custody.unlock();

          const newer = await custody.publicKeys();

          complete();
          const oldResult = await old;
          const after = await custody.publicKeys();

          return {
            oldResult,
            newerRetained:
              JSON.stringify(before) === JSON.stringify(newer) && JSON.stringify(newer) === JSON.stringify(after),
          };
        } finally {
          api.BrowserVault.prototype.unlock = original;
          custody.close();
        }
      },
      { vector },
    );

    expect(result).toEqual({ oldResult: 'stale-operation', newerRetained: true });
  } finally {
    await page.close();
  }
}, 60_000);
