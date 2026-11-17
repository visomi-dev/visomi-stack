import { describe, expect, it } from 'vitest';

import { browser, prepare, vector, type FixtureWindow } from './support/browser';

describe('actual Chromium historical recipient key custody', () => {
  it('rejects invalid historical contexts and clears key material if locking interrupts its local wrapping', async () => {
    const page = await browser.newPage();

    try {
      await prepare(page);

      const result = await page.evaluate(async (vector) => {
        const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
        const binding = {
          ...vector.wrapped.context,
          origin: location.origin,
          key: { ...vector.wrapped.context.key, generation: 2 },
        };
        const storage = await api.IndexedDbVaultStorage.open(indexedDB, crypto.randomUUID());
        const cipher = new api.WebCryptoCipher(crypto);
        const vault = new api.BrowserVault(
          binding.ownerId,
          storage,
          { secret: async () => new Uint8Array(32).fill(9), cancel: () => undefined },
          cipher,
        );
        const failures: string[] = [];

        try {
          await vault.installHistory(vector.data.context.key, new Uint8Array(32));
        } catch (error) {
          failures.push((error as { code: string }).code);
        }

        await vault.install(binding, new Uint8Array(32).fill(23));

        for (const key of [
          binding.key,
          { ...binding.key, generation: 0 },
          { ...vector.data.context.key, domain: 'another-domain' },
        ]) {
          try {
            await vault.installHistory(key, new Uint8Array(32));
          } catch (error) {
            failures.push((error as { code: string }).code);
          }
        }

        try {
          await vault.installHistory(vector.data.context.key, new Uint8Array(31));
        } catch (error) {
          failures.push((error as { code: string }).code);
        }

        await vault.unlock(binding);

        let release!: () => void;
        let started!: () => void;
        const wait = new Promise<void>((resolve) => {
          release = resolve;
        });
        const wrapping = new Promise<void>((resolve) => {
          started = resolve;
        });
        const original = cipher.wrap.bind(cipher);
        let raw: Uint8Array | undefined;
        let secret: Uint8Array | undefined;

        cipher.wrap = async (unlock, supplied, context) => {
          raw = supplied;
          secret = unlock;
          const envelope = await original(unlock, supplied, context);

          started();

          await wait;

          return envelope;
        };
        const installing = vault.installHistory(vector.data.context.key, new Uint8Array(32).fill(7));

        await wrapping;

        vault.lock();
        release();

        try {
          await installing;
        } catch (error) {
          failures.push((error as { code: string }).code);
        }

        const saved = await storage.getKey(contracts.keyDomainId(binding.ownerId, vector.data.context.key));

        vault.close();

        return {
          failures,
          saved: !!saved,
          rawCleared: !!raw?.length && raw.every((byte) => byte === 0),
          secretCleared: !!secret?.length && secret.every((byte) => byte === 0),
        };
      }, vector);

      expect(result).toEqual({
        failures: ['locked', 'corrupt', 'corrupt', 'corrupt', 'corrupt', 'stale-operation'],
        saved: false,
        rawCleared: true,
        secretCleared: true,
      });
    } finally {
      await page.close();
    }
  });
  it('delivers retained keys explicitly, restores encrypted wrappers, and never grants old-generation writes', async () => {
    const page = await browser.newPage();

    try {
      await prepare(page);

      const result = await page.evaluate(async (vector) => {
        const { api } = (globalThis as FixtureWindow).fixtureModules;
        const binding = { ...vector.wrapped.context, origin: location.origin };
        const database = crypto.randomUUID();
        const storage = await api.IndexedDbVaultStorage.open(indexedDB, database);
        const unlock = { secret: async () => new Uint8Array(32).fill(9), cancel: () => undefined };
        const cipher = new api.WebCryptoCipher(crypto);
        const old = new api.BrowserVault(binding.ownerId, storage, unlock, cipher);

        await old.install(binding, new Uint8Array(32).fill(7));

        const envelope = await old.encrypt(
          vector.data.context,
          new TextEncoder().encode('Synthetic retained plaintext'),
        );
        const nextBinding = { ...binding, key: { ...binding.key, generation: 2 } };

        await old.initialize(nextBinding);

        const devices = new api.WebCryptoDevices(crypto);
        const recipient = await devices.createIdentity();
        const publicKeys = await devices.publicKeys(recipient);
        const deliveryBinding = {
          key: nextBinding.key,
          ownerId: binding.ownerId,
          deviceId: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          challenge: api.encodeBytes(new Uint8Array(32).fill(1)),
          fingerprint: api.encodeBytes(new Uint8Array(32).fill(2)),
          encryption: publicKeys.encryption,
        };
        const currentDelivery = await old.deliver(deliveryBinding, devices);
        const history = await old.deliverHistory({ ...deliveryBinding, key: binding.key }, devices);
        const currentRaw = await devices.open(recipient.encryption.privateKey, deliveryBinding, currentDelivery);
        const historicalRaw = await devices.open(recipient.encryption.privateKey, history.binding, history);
        const receiverDatabase = crypto.randomUUID();
        const receiverStorage = await api.IndexedDbVaultStorage.open(indexedDB, receiverDatabase);
        const receiverBinding = { ...nextBinding, deviceId: deliveryBinding.deviceId };
        const receiver = new api.BrowserVault(binding.ownerId, receiverStorage, unlock, cipher);

        try {
          await receiver.install(receiverBinding, currentRaw);

          await receiver.installHistory(binding.key, historicalRaw);
        } finally {
          currentRaw.fill(0);
          historicalRaw.fill(0);
        }

        const active = await receiverStorage.getCurrentKey(binding.ownerId, nextBinding.key);
        let rollback = '';

        try {
          await receiverStorage.getCurrentKey(binding.ownerId, binding.key);
        } catch (error) {
          rollback = (error as { code: string }).code;
        }

        let oldWrite = '';

        try {
          await receiver.encrypt(vector.data.context, new Uint8Array(1));
        } catch (error) {
          oldWrite = (error as { code: string }).code;
        }

        const clear = await receiver.decrypt(envelope.context, envelope);
        const text = new TextDecoder().decode(clear);

        clear.fill(0);
        receiver.close();

        const reopenedStorage = await api.IndexedDbVaultStorage.open(indexedDB, receiverDatabase);
        const reopened = new api.BrowserVault(binding.ownerId, reopenedStorage, unlock, cipher);

        await reopened.unlock(receiverBinding);

        const again = await reopened.decrypt(envelope.context, envelope);
        const reopenedText = new TextDecoder().decode(again);

        again.fill(0);
        reopened.close();

        const archivedStorage = await api.IndexedDbVaultStorage.open(indexedDB, receiverDatabase);
        const archived = new api.BrowserVault(binding.ownerId, archivedStorage, unlock, cipher);

        await archived.unlock({ ...receiverBinding, key: binding.key });

        let exhausted = '';

        try {
          await archived.encrypt(vector.data.context, new Uint8Array(1));
        } catch (error) {
          exhausted = (error as { code: string }).code;
        }

        archived.close();
        old.close();

        return { text, reopenedText, oldWrite, exhausted, rollback, active: active?.context.key.generation };
      }, vector);

      expect(result).toEqual({
        text: 'Synthetic retained plaintext',
        reopenedText: 'Synthetic retained plaintext',
        oldWrite: 'corrupt',
        exhausted: 'quota',
        rollback: 'corrupt',
        active: 2,
      });
    } finally {
      await page.close();
    }
  });

  it.each(['lock', 'corrupt'] as const)(
    'clears historical plaintext and unwrapped key bytes when %s interrupts decryption',
    async (mode) => {
      const page = await browser.newPage();

      try {
        await prepare(page);

        const result = await page.evaluate(
          async ({ vector, mode }) => {
            const { api } = (globalThis as FixtureWindow).fixtureModules;
            const binding = {
              ...vector.wrapped.context,
              origin: location.origin,
              key: { ...vector.wrapped.context.key, generation: 2 },
            };
            const storage = await api.IndexedDbVaultStorage.open(indexedDB, crypto.randomUUID());
            const secret = () => new Uint8Array(32).fill(9);
            const cipher = new api.WebCryptoCipher(crypto);
            const vault = new api.BrowserVault(
              binding.ownerId,
              storage,
              { secret: async () => secret(), cancel: () => undefined },
              cipher,
            );

            await vault.install(binding, new Uint8Array(32).fill(23));

            await vault.installHistory(vector.data.context.key, new Uint8Array(32).fill(7));

            const key = await cipher.importDataKey(new Uint8Array(32).fill(7));
            const envelope = await cipher.seal(
              key,
              vector.data.context,
              new TextEncoder().encode('Synthetic race plaintext'),
            );
            const originalImport = cipher.importDataKey.bind(cipher);
            const originalOpen = cipher.open.bind(cipher);
            let raw: Uint8Array | undefined;
            let clear: Uint8Array | undefined;
            let failure = '';

            cipher.importDataKey = async (value) => {
              raw = value;
              const key = await originalImport(value);

              return key;
            };
            cipher.open = async (...args) => {
              const value = await originalOpen(...args);

              clear = value;

              if (mode === 'lock') {
                vault.lock();
              } else {
                try {
                  await vault.decrypt({ ...envelope.context, key: binding.key }, envelope);
                } catch (error) {
                  failure = (error as { code: string }).code;
                }
              }

              return value;
            };
            let code = '';

            try {
              await vault.decrypt(envelope.context, envelope);
            } catch (error) {
              code = (error as { code: string }).code;
            }

            vault.close();

            return {
              code,
              failure,
              rawCleared: !!raw?.length && raw.every((byte) => byte === 0),
              clearCleared: !!clear?.length && clear.every((byte) => byte === 0),
            };
          },
          { vector, mode },
        );

        expect(result).toEqual({
          code: 'stale-operation',
          failure: mode === 'lock' ? '' : 'corrupt',
          rawCleared: true,
          clearCleared: true,
        });
      } finally {
        await page.close();
      }
    },
  );
});
