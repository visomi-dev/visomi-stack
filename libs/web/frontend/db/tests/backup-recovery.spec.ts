import { describe, expect, it } from 'vitest';

import { browser, prepare, vector, type FixtureWindow } from './support/browser';

describe('actual Chromium encrypted backup, recovery and recipient delivery', () => {
  it('generates a fresh generation key, wraps a verified recipient batch with one unlock and prevents old-key decryption', async () => {
    const page = await browser.newPage();

    try {
      await prepare(page);

      const result = await page.evaluate(
        async ({ vector }) => {
          const { api } = (globalThis as FixtureWindow).fixtureModules;
          const binding = { ...vector.wrapped.context, origin: location.origin };
          const name = crypto.randomUUID();
          const storage = await api.IndexedDbVaultStorage.open(indexedDB, name);
          let prompts = 0;
          const unlock = {
            async secret() {
              prompts++;

              return new Uint8Array(32).fill(9);
            },
            cancel: () => undefined,
          };
          const cipher = new api.WebCryptoCipher(crypto);
          const old = new api.BrowserVault(binding.ownerId, storage, unlock, cipher);

          await old.initialize(binding);

          await old.seal(vector.data.context, new TextEncoder().encode('Synthetic old generation'));

          const devices = new api.WebCryptoDevices(crypto);
          const receiver = await devices.createIdentity();
          const publicKeys = await devices.publicKeys(receiver);
          const recipient = {
            key: binding.key,
            ownerId: binding.ownerId,
            deviceId: crypto.randomUUID(),
            requestId: crypto.randomUUID(),
            challenge: api.encodeBytes(new Uint8Array(32).fill(1)),
            fingerprint: api.encodeBytes(new Uint8Array(32).fill(2)),
            encryption: publicKeys.encryption,
          };
          const previousDelivery = await old.deliver(recipient, devices);
          const previousRaw = await devices.open(receiver.encryption.privateKey, recipient, previousDelivery);
          const previousKey = await cipher.importDataKey(previousRaw);
          const nextBinding = { ...binding, key: { ...binding.key, generation: 2 } };
          const secondStorage = await api.IndexedDbVaultStorage.open(indexedDB, name);
          const next = new api.BrowserVault(binding.ownerId, secondStorage, unlock, cipher);

          await next.initialize(nextBinding);

          const context = { ...vector.data.context, key: nextBinding.key, revision: 2 };
          const envelope = await next.seal(context, new TextEncoder().encode('Synthetic new generation'));
          const before = prompts;
          const first = { ...recipient, key: nextBinding.key };
          const second = { ...first, deviceId: crypto.randomUUID(), requestId: crypto.randomUUID() };
          const deliveries = await next.deliverBatch([first, second], devices);
          const newRaw = await devices.open(receiver.encryption.privateKey, first, deliveries[0]);
          const otherRaw = await devices.open(receiver.encryption.privateKey, second, deliveries[1]);
          const changed = previousRaw.some((value, index) => value !== newRaw[index]);
          const sameBatchKey = newRaw.every((value, index) => value === otherRaw[index]);

          previousRaw.fill(0);
          newRaw.fill(0);
          otherRaw.fill(0);
          let oldKey = '';

          try {
            await cipher.open(previousKey, context, envelope);
          } catch (error) {
            oldKey = (error as { code: string }).code;
          }
          const clear = await next.decrypt(context, envelope);
          const text = new TextDecoder().decode(clear);

          clear.fill(0);
          const batchPrompts = prompts - before;

          old.close();
          next.close();

          return { changed, sameBatchKey, batchPrompts, oldKey, text };
        },
        { vector },
      );

      expect(result).toEqual({
        changed: true,
        sameBatchKey: true,
        batchPrompts: 1,
        oldKey: 'integrity-failure',
        text: 'Synthetic new generation',
      });
    } finally {
      await page.close();
    }
  });
  it('exports ciphertext only, restores atomically while locked, and requires rotation before restored keys write', async () => {
    const page = await browser.newPage();

    try {
      await prepare(page);

      const result = await page.evaluate(
        async ({ vector }) => {
          const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
          const binding = { ...vector.wrapped.context, origin: location.origin };
          const context = vector.data.context;
          const source = { secret: async () => new Uint8Array(32).fill(9), cancel: () => undefined };
          const storage = await api.IndexedDbVaultStorage.open(indexedDB, crypto.randomUUID());
          const vault = new api.BrowserVault(binding.ownerId, storage, source, new api.WebCryptoCipher(crypto));

          await vault.initialize(binding);

          await vault.seal(context, new TextEncoder().encode('Synthetic private backup content'));

          const backup = await api.exportEncryptedBackup(storage, binding, [context]);

          vault.lock();
          const destination = await api.IndexedDbVaultStorage.open(indexedDB, crypto.randomUUID());

          await api.restoreEncryptedBackup(destination, binding, 1, backup);

          const restored = new api.BrowserVault(binding.ownerId, destination, source, new api.WebCryptoCipher(crypto));
          let locked = '';

          try {
            await restored.open(context);
          } catch (error) {
            locked = (error as { code: string }).code;
          }

          await restored.unlock(binding);

          const opened = await restored.open(context);
          const text = new TextDecoder().decode(opened);

          opened.fill(0);
          let quota = '';

          try {
            await restored.seal({ ...context, revision: 2 }, new Uint8Array());
          } catch (error) {
            quota = (error as { code: string }).code;
          }
          let collision = '';

          try {
            await api.restoreEncryptedBackup(destination, binding, 1, backup);
          } catch (error) {
            collision = (error as { code: string }).code;
          }
          const empty = await api.IndexedDbVaultStorage.open(indexedDB, crypto.randomUUID());
          let rollback = '';

          try {
            await api.restoreEncryptedBackup(empty, binding, 2, backup);
          } catch (error) {
            rollback = (error as { code: string }).code;
          }
          const missing = await empty.getKey(contracts.keyDomainId(binding.ownerId, binding.key));

          await restored.forget(binding);

          let forgotten = '';

          try {
            await restored.unlock(binding);
          } catch (error) {
            forgotten = (error as { code: string }).code;
          }
          vault.close();
          restored.close();
          empty.close();

          return {
            plaintextInBackup: backup.includes('Synthetic private backup content'),
            locked,
            text,
            quota,
            collision,
            rollback,
            partialKey: missing !== undefined,
            forgotten,
          };
        },
        { vector },
      );

      expect(result).toEqual({
        plaintextInBackup: false,
        locked: 'locked',
        text: 'Synthetic private backup content',
        quota: 'quota',
        collision: 'revision-conflict',
        rollback: 'corrupt',
        partialKey: false,
        forgotten: 'recovery-required',
      });
    } finally {
      await page.close();
    }
  });

  it('requires configured user-held recovery, rejects wrong secrets and cancels delayed recovery on lock', async () => {
    const page = await browser.newPage();

    try {
      await prepare(page);

      const result = await page.evaluate(
        async ({ vector }) => {
          const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
          const binding = { ...vector.wrapped.context, origin: location.origin };
          const context = vector.data.context;
          const source = { secret: async () => new Uint8Array(32).fill(9), cancel: () => undefined };
          const storage = await api.IndexedDbVaultStorage.open(indexedDB, crypto.randomUUID());
          const vault = new api.BrowserVault(binding.ownerId, storage, source, new api.WebCryptoCipher(crypto));

          await vault.initialize(binding);

          const envelope = await vault.seal(context, new TextEncoder().encode('Synthetic recovered resource'));
          const recoveryBinding = { ...binding, method: 'recovery-key' as const, methodId: 'Ag' };
          const recovery = new api.UserHeldRecovery(async () => new Uint8Array(32).fill(13));
          let denied = '';

          try {
            await vault.createRecovery(contracts.syntheticHybridPolicy, recoveryBinding, recovery);
          } catch (error) {
            denied = (error as { code: string }).code;
          }
          const policy = structuredClone(contracts.syntheticHybridPolicy);
          const domain = policy.domains.find((domain) => domain.domain === binding.key.domain);

          if (!domain || domain.readers !== 'client-keys-only') {
            throw new Error('synthetic_policy_missing');
          }

          domain.recovery = 'user-held-recovery-key';
          const backup = await vault.createRecovery(policy, recoveryBinding, recovery);
          const target = await api.IndexedDbVaultStorage.open(indexedDB, crypto.randomUUID());
          const restored = new api.BrowserVault(binding.ownerId, target, source, new api.WebCryptoCipher(crypto));
          const local = { ...binding, deviceId: crypto.randomUUID(), methodId: 'Aw' };
          let wrong = '';

          try {
            await restored.installRecovery(
              policy,
              recoveryBinding,
              backup,
              new api.UserHeldRecovery(async () => new Uint8Array(32).fill(14)),
              local,
              1,
            );
          } catch (error) {
            wrong = (error as { code: string }).code;
          }

          await restored.installRecovery(policy, recoveryBinding, backup, recovery, local, 1);

          const clear = await restored.decrypt(context, envelope);
          const text = new TextDecoder().decode(clear);

          clear.fill(0);
          let write = '';

          try {
            await restored.seal({ ...context, revision: 2 }, new Uint8Array());
          } catch (error) {
            write = (error as { code: string }).code;
          }
          const cancelledStorage = await api.IndexedDbVaultStorage.open(indexedDB, crypto.randomUUID());
          const cancelledVault = new api.BrowserVault(
            binding.ownerId,
            cancelledStorage,
            source,
            new api.WebCryptoCipher(crypto),
          );
          let complete: (value: Uint8Array) => void = () => undefined;
          let started: () => void = () => undefined;
          const entering = new Promise<void>((resolve) => {
            started = resolve;
          });
          const delayed = new api.UserHeldRecovery(async () => {
            started();
            const value = await new Promise<Uint8Array>((resolve) => {
              complete = resolve;
            });

            return value;
          });
          const pending = cancelledVault.installRecovery(policy, recoveryBinding, backup, delayed, local, 1).then(
            () => '',
            (error) => (error as { code: string }).code,
          );

          await entering;

          cancelledVault.lock();
          const secret = new Uint8Array(32).fill(13);

          complete(secret);
          const cancelled = await pending;
          const absent = await cancelledStorage.getKey(contracts.keyDomainId(binding.ownerId, binding.key));

          vault.close();
          restored.close();
          cancelledVault.close();

          return {
            denied,
            wrong,
            text,
            write,
            cancelled,
            keyAfterCancel: absent !== undefined,
            secretCleared: secret.every((value) => value === 0),
          };
        },
        { vector },
      );

      expect(result).toEqual({
        denied: 'recovery-required',
        wrong: 'integrity-failure',
        text: 'Synthetic recovered resource',
        write: 'quota',
        cancelled: 'cancelled',
        keyAfterCancel: false,
        secretCleared: true,
      });
    } finally {
      await page.close();
    }
  });

  it('delivers a live scope key only as contextual recipient ciphertext', async () => {
    const page = await browser.newPage();

    try {
      await prepare(page);

      const result = await page.evaluate(
        async ({ vector }) => {
          const { api } = (globalThis as FixtureWindow).fixtureModules;
          const binding = { ...vector.wrapped.context, origin: location.origin };
          const source = { secret: async () => new Uint8Array(32).fill(9), cancel: () => undefined };
          const storage = await api.IndexedDbVaultStorage.open(indexedDB, crypto.randomUUID());
          const cipher = new api.WebCryptoCipher(crypto);
          const vault = new api.BrowserVault(binding.ownerId, storage, source, cipher);

          await vault.initialize(binding);

          const envelope = await vault.seal(vector.data.context, new TextEncoder().encode('Synthetic shared resource'));
          const devices = new api.WebCryptoDevices(crypto);
          const recipient = await devices.createIdentity();
          const keys = await devices.publicKeys(recipient);
          const challenge = {
            format: 'visomi.device-enrollment' as const,
            version: 1 as const,
            key: binding.key,
            ownerId: crypto.randomUUID(),
            deviceId: crypto.randomUUID(),
            requestId: crypto.randomUUID(),
            challenge: api.encodeBytes(crypto.getRandomValues(new Uint8Array(32))),
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            keys,
          };
          const fingerprint = await devices.fingerprint(challenge);
          const deliveryBinding = {
            key: binding.key,
            ownerId: challenge.ownerId,
            deviceId: challenge.deviceId,
            requestId: challenge.requestId,
            challenge: challenge.challenge,
            fingerprint,
            encryption: keys.encryption,
          };
          const delivery = await vault.deliver(deliveryBinding, devices);
          const raw = await devices.open(recipient.encryption.privateKey, deliveryBinding, delivery);
          const key = await cipher.importDataKey(raw);

          raw.fill(0);
          const clear = await cipher.open(key, vector.data.context, envelope);
          const text = new TextDecoder().decode(clear);

          clear.fill(0);
          vault.close();

          return {
            text,
            ciphertextLength: delivery.ciphertext.length,
            plaintextInDelivery: JSON.stringify(delivery).includes('Synthetic shared resource'),
          };
        },
        { vector },
      );

      expect(result).toEqual({ text: 'Synthetic shared resource', ciphertextLength: 512, plaintextInDelivery: false });
    } finally {
      await page.close();
    }
  });
});
