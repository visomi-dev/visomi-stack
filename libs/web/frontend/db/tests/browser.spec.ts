import { describe, expect, it } from 'vitest';

import { browser, prepare, vector, type FixtureWindow } from './support/browser';

describe('actual Chromium WebCrypto and IndexedDB vault', () => {
  it('blocks a credential without PRF instead of creating a fallback key', async () => {
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
          hasPrf: false,
        },
      });

      await prepare(page);

      const result = await page.evaluate(
        async ({ vector }) => {
          const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
          const credential = await navigator.credentials.create({
            publicKey: {
              challenge: crypto.getRandomValues(new Uint8Array(32)),
              rp: { id: location.hostname, name: 'Synthetic no-PRF fixture' },
              user: {
                id: crypto.getRandomValues(new Uint8Array(32)),
                name: 'synthetic@example.test',
                displayName: 'Synthetic user',
              },
              pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
              authenticatorSelection: { userVerification: 'required' },
            },
          });

          if (!credential) {
            throw new Error('synthetic_credential_missing');
          }

          const binding = { ...vector.wrapped.context, methodId: credential.id, origin: location.origin };
          const unlocker = new api.PrfUnlock({
            origin: location.origin,
            rpId: location.hostname,
            credentials: navigator.credentials,
            crypto,
          });
          const storage = await api.IndexedDbVaultStorage.open(
            indexedDB,
            `synthetic-unsupported-${crypto.randomUUID()}`,
          );
          const vault = new api.BrowserVault(binding.ownerId, storage, unlocker, new api.WebCryptoCipher(crypto));
          let code = '';

          try {
            await vault.initialize(binding);
          } catch (error) {
            code = (error as { code: string }).code;
          }
          const key = await storage.getKey(contracts.keyDomainId(binding.ownerId, binding.key));
          const state = vault.state;

          vault.close();

          return { code, state, keyPresent: key !== undefined };
        },
        { vector },
      );

      expect(result).toEqual({ code: 'unsupported-prf', state: 'unsupported-prf', keyPresent: false });
    } finally {
      await context.close();
    }
  }, 60_000);

  it('propagates a secret-free lock across two actual browser tabs', async () => {
    const context = await browser.newContext();

    try {
      const first = await context.newPage();
      const second = await context.newPage();
      const name = `synthetic-tabs-${Date.now()}`;

      await prepare(first);

      await prepare(second);

      for (const [index, page] of [first, second].entries()) {
        await page.evaluate(
          async ({ name, vector, initialize }) => {
            const host = globalThis as FixtureWindow;
            const { api } = host.fixtureModules;
            const storage = await api.IndexedDbVaultStorage.open(indexedDB, name);
            const unlocker = {
              async secret() {
                return new Uint8Array(32).fill(9);
              },
              cancel() {
                return undefined;
              },
            };
            const vault = new api.BrowserVault(
              vector.wrapped.context.ownerId,
              storage,
              unlocker,
              new api.WebCryptoCipher(crypto),
              (state) => {
                host.fixtureState = state;
              },
              new BroadcastChannel(name),
            );

            host.fixtureVault = vault;

            if (initialize) {
              await vault.initialize(vector.wrapped.context);
            } else {
              await vault.unlock(vector.wrapped.context);
            }
          },
          { name, vector, initialize: index === 0 },
        );
      }

      await first.evaluate(() => (globalThis as FixtureWindow).fixtureVault?.lock());

      await second.waitForFunction(() => (globalThis as FixtureWindow).fixtureState === 'locked');

      const state = await second.evaluate(() => (globalThis as FixtureWindow).fixtureVault?.state);

      expect(state).toBe('locked');

      await first.evaluate(() => (globalThis as FixtureWindow).fixtureVault?.close());

      await second.evaluate(() => (globalThis as FixtureWindow).fixtureVault?.close());
    } finally {
      await context.close();
    }
  }, 60_000);

  it('unlocks locally with real WebAuthn PRF from a virtual authenticator and fails closed on missing PRF/origin mismatch', async () => {
    const context = await browser.newContext();

    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);

      await cdp.send('WebAuthn.enable');

      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          ctap2Version: 'ctap2_1',
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
          const { api } = (globalThis as FixtureWindow).fixtureModules;
          const credential = await navigator.credentials.create({
            publicKey: {
              challenge: crypto.getRandomValues(new Uint8Array(32)),
              rp: { id: location.hostname, name: 'Synthetic vault fixture' },
              user: {
                id: crypto.getRandomValues(new Uint8Array(32)),
                name: 'synthetic@example.test',
                displayName: 'Synthetic test user',
              },
              pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
              authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
              extensions: { prf: {} },
            },
          });

          if (!credential || credential.type !== 'public-key') {
            throw new Error('synthetic_credential_missing');
          }

          const publicKey = credential as PublicKeyCredential;
          const binding = { ...vector.wrapped.context, origin: location.origin, methodId: publicKey.id };
          const environment = {
            origin: location.origin,
            rpId: location.hostname,
            credentials: navigator.credentials,
            crypto,
          };
          const unlocker = new api.PrfUnlock(environment);
          const storage = await api.IndexedDbVaultStorage.open(indexedDB, `synthetic-prf-${crypto.randomUUID()}`);
          const vault = new api.BrowserVault(binding.ownerId, storage, unlocker, new api.WebCryptoCipher(crypto));

          await vault.initialize(binding);

          await vault.seal(vector.data.context, new TextEncoder().encode('SYNTHETIC-PRF-PLAINTEXT'));

          vault.lock();

          await vault.unlock(binding);

          const bytes = await vault.open(vector.data.context);
          const text = new TextDecoder().decode(bytes);

          bytes.fill(0);
          let wrongOrigin = '';
          let unsupported = '';

          try {
            await unlocker.secret({ ...binding, origin: 'https://wrong.example.test' });
          } catch (error) {
            wrongOrigin = (error as { code: string }).code;
          }
          const noPrf = new api.PrfUnlock({ ...environment, credentials: undefined });

          try {
            await noPrf.secret(binding);
          } catch (error) {
            unsupported = (error as { code: string }).code;
          }
          vault.close();

          return { text, wrongOrigin, unsupported, prfEnabled: publicKey.getClientExtensionResults().prf?.enabled };
        },
        { vector },
      );

      expect(result).toEqual({
        text: 'SYNTHETIC-PRF-PLAINTEXT',
        wrongOrigin: 'origin-mismatch',
        unsupported: 'unsupported-prf',
        prfEnabled: true,
      });
    } finally {
      await context.close();
    }
  }, 60_000);

  it('persists ciphertext only, reopens locked and rejects reads completing after lock', async () => {
    const context = await browser.newContext();

    try {
      const page = await context.newPage();

      await prepare(page);

      const result = await page.evaluate(
        async ({ vector }) => {
          const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
          const database = `synthetic-${crypto.randomUUID()}`;
          const storage = await api.IndexedDbVaultStorage.open(indexedDB, database);
          const cipher = new api.WebCryptoCipher(crypto);
          const secrets: Uint8Array[] = [];
          const unlocker = {
            async secret() {
              const value = new Uint8Array(32).fill(9);

              secrets.push(value);

              return value;
            },
            cancel() {
              return undefined;
            },
          };
          const vault = new api.BrowserVault(vector.wrapped.context.ownerId, storage, unlocker, cipher);

          await vault.initialize(vector.wrapped.context);

          const plaintext = new TextEncoder().encode('SYNTHETIC-VIEW-PLAINTEXT-MARKER');
          const envelope = await vault.seal(vector.data.context, plaintext);
          const key = await storage.getKey(
            contracts.keyDomainId(vector.wrapped.context.ownerId, vector.wrapped.context.key),
          );
          const stored = await storage.getUnit(
            contracts.vaultUnitId(vector.wrapped.context.ownerId, vector.data.context),
          );
          const serialized = JSON.stringify({ key, stored });
          const opened = await vault.open(vector.data.context);
          const text = new TextDecoder().decode(opened);

          opened.fill(0);
          const pending = vault.open(vector.data.context);

          vault.lock();
          let stale = '';

          try {
            await pending;
          } catch (error) {
            stale = (error as { code: string }).code;
          }
          vault.close();
          const reopened = await api.IndexedDbVaultStorage.open(indexedDB, database);
          const again = new api.BrowserVault(vector.wrapped.context.ownerId, reopened, unlocker, cipher);
          const initial = again.state;
          let locked = '';

          try {
            await again.open(vector.data.context);
          } catch (error) {
            locked = (error as { code: string }).code;
          }

          await again.unlock(vector.wrapped.context);

          const restored = await again.open(vector.data.context);
          const restoredText = new TextDecoder().decode(restored);

          restored.fill(0);
          again.close();

          return {
            text,
            restoredText,
            serializedHasPlaintext: serialized.includes('SYNTHETIC-VIEW-PLAINTEXT-MARKER'),
            initial,
            stale,
            locked,
            nonceLength: envelope.nonce.length,
            secretsErased: secrets.every((secret) => secret.every((value) => value === 0)),
          };
        },
        { vector },
      );

      expect(result).toEqual({
        text: 'SYNTHETIC-VIEW-PLAINTEXT-MARKER',
        restoredText: 'SYNTHETIC-VIEW-PLAINTEXT-MARKER',
        serializedHasPlaintext: false,
        initial: 'locked',
        stale: 'stale-operation',
        locked: 'locked',
        nonceLength: 16,
        secretsErased: true,
      });
    } finally {
      await context.close();
    }
  }, 60_000);

  it('uses committed IndexedDB CAS and quota accounting across independent storage connections', async () => {
    const context = await browser.newContext();

    try {
      const page = await context.newPage();

      await prepare(page);

      const result = await page.evaluate(
        async ({ vector }) => {
          const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
          const name = `synthetic-${crypto.randomUUID()}`;
          const one = await api.IndexedDbVaultStorage.open(indexedDB, name);
          const two = await api.IndexedDbVaultStorage.open(indexedDB, name);
          const keyId = contracts.keyDomainId(vector.wrapped.context.ownerId, vector.wrapped.context.key);
          const rawKey = new Uint8Array(32).fill(7);
          const cipher = new api.WebCryptoCipher(crypto);
          const wrapped = await cipher.wrap(new Uint8Array(32).fill(9), rawKey, vector.wrapped.context);
          const key = await cipher.importDataKey(rawKey);

          rawKey.fill(0);

          await one.putKey(keyId, wrapped);

          const reserved = await Promise.allSettled([one.reserveEncryption(keyId, 1), two.reserveEncryption(keyId, 1)]);
          const envelope = await cipher.seal(key, vector.data.context, new Uint8Array([1]));
          const id = contracts.vaultUnitId(vector.wrapped.context.ownerId, vector.data.context);
          const writes = await Promise.allSettled([one.putUnit(id, 0, envelope), two.putUnit(id, 0, envelope)]);
          const stored = await two.getUnit(id);

          one.close();
          two.close();

          return {
            reservations: reserved.map((entry) => entry.status).sort(),
            writes: writes.map((entry) => entry.status).sort(),
            revision: stored?.context.revision ?? null,
          };
        },
        { vector },
      );

      expect(result).toEqual({
        reservations: ['fulfilled', 'rejected'],
        writes: ['fulfilled', 'rejected'],
        revision: 1,
      });
    } finally {
      await context.close();
    }
  }, 60_000);
});

it('keeps the encryption reservation after a stale IndexedDB write and browser reopen', async () => {
  const context = await browser.newContext();

  try {
    const page = await context.newPage();

    await prepare(page);

    const result = await page.evaluate(
      async ({ vector }) => {
        const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
        const binding = vector.wrapped.context;
        const name = `synthetic-reservations-${crypto.randomUUID()}`;
        const storage = await api.IndexedDbVaultStorage.open(indexedDB, name);
        const keyId = contracts.keyDomainId(binding.ownerId, binding.key);
        const reserve = storage.reserveEncryption.bind(storage);

        // Use the real IndexedDB transaction with a small limit for the fixture.
        storage.reserveEncryption = (id) => reserve(id, 2);
        const unlocker = {
          async secret() {
            return new Uint8Array(32).fill(9);
          },
          cancel() {
            return undefined;
          },
        };
        const vault = new api.BrowserVault(binding.ownerId, storage, unlocker, new api.WebCryptoCipher(crypto));

        await vault.initialize(binding);

        const first = await vault.seal(vector.data.context, new Uint8Array([1]));
        let stale: string | undefined;

        try {
          await vault.seal(vector.data.context, new Uint8Array([2]));
        } catch (error) {
          stale = (error as { code: string }).code;
        }

        vault.close();

        const reopened = await api.IndexedDbVaultStorage.open(indexedDB, name);
        let exhausted: string | undefined;

        try {
          await reopened.reserveEncryption(keyId, 2);
        } catch (error) {
          exhausted = (error as { code: string }).code;
        }

        const unitId = contracts.vaultUnitId(binding.ownerId, vector.data.context);
        const unit = await reopened.getUnit(unitId);

        reopened.close();

        return { stale, exhausted, preserved: first.ciphertext === unit?.ciphertext };
      },
      { vector },
    );

    expect(result).toEqual({ stale: 'revision-conflict', exhausted: 'quota', preserved: true });
  } finally {
    await context.close();
  }
});
