import { expect, it } from 'vitest';

import { browser, prepare, vector, pinVector, type FixtureWindow } from './support/browser';

it('encrypts and reopens local data and independent signing custody with a PIN without WebAuthn or network', async () => {
  const page = await browser.newPage();

  try {
    await prepare(page);

    // Modules have loaded; all subsequent operations must work with no network or authenticator.
    await page.context().setOffline(true);

    const result = await page.evaluate(
      async ({ vector }) => {
        const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;

        Object.defineProperty(navigator, 'credentials', { value: undefined });
        const binding = { ...vector.wrapped.context, method: api.pinMethod, methodId: api.createPinMethodId(crypto) };
        const context = { ...vector.data.context, key: binding.key, target: binding.key.scope };
        const owner = binding.ownerId;
        const source = () => new api.PinUnlock(async () => new TextEncoder().encode('048261'));
        const open = () => api.IndexedDbVaultStorage.open(indexedDB, owner);
        const storage = await open();
        const vault = new api.BrowserVault(owner, storage, source(), new api.WebCryptoCipher(crypto));
        const original = new TextEncoder().encode('SYNTHETIC_OFFLINE_PIN_CONTENT');

        await vault.initialize(binding);

        const envelope = await vault.seal(context, original);
        const custodyStorage = await open();
        const custody = new api.DeviceCustody(custodyStorage, binding, source(), crypto);

        await custody.unlock(true);

        const publicKeys = await custody.publicKeys();

        custody.close();
        vault.close();
        const reopenedStorage = await open();
        const located = await reopenedStorage.getLatestKey(owner, binding.key);
        const replicaStore = await api.IndexedDbReplicaStorage.open(indexedDB, owner);
        const replicaId = api.replicaId(owner, binding.key, binding.key.scope);

        await replicaStore.advanceControl(replicaId, { epoch: 3, generation: 2 });

        await replicaStore.advanceControl(replicaId, { epoch: 2, generation: 1 });

        const retained = await replicaStore.pin(replicaId);
        const rosterFloor =
          retained.epoch === 3 && retained.cursor === 0 && retained.checkpoint === null && retained.generation === 2;

        replicaStore.close();
        const catalog = await reopenedStorage.latestBindings(owner);
        const discovered =
          catalog.length === 2 &&
          catalog.some((value) => value.key.domain === 'device-custody') &&
          catalog.some((value) => value.key.domain === binding.key.domain);
        const wrongOwner = await reopenedStorage.latestBindings(crypto.randomUUID()).then(
          () => 'accepted',
          (error) => error.code,
        );
        const reopened = new api.BrowserVault(owner, reopenedStorage, source(), new api.WebCryptoCipher(crypto));

        await reopened.unlock(located!.context);

        const clear = await reopened.open(context);
        const equal = new TextDecoder().decode(clear) === new TextDecoder().decode(original);

        clear.fill(0);
        const identityStorage = await open();
        const reopenedCustody = new api.DeviceCustody(identityStorage, binding, source(), crypto);

        await reopenedCustody.unlock();

        const restoredKeys = await reopenedCustody.publicKeys();
        const sameIdentity = JSON.stringify(restoredKeys) === JSON.stringify(publicKeys);
        const id = contracts.keyDomainId(owner, binding.key);
        const wrapped = await reopenedStorage.getKey(id);
        const onlyCiphertext =
          !JSON.stringify([wrapped, envelope]).includes('SYNTHETIC_OFFLINE_PIN_CONTENT') &&
          !JSON.stringify(wrapped).includes('048261');

        reopened.close();
        reopenedCustody.close();
        const wrongStorage = await open();
        const wrong = new api.BrowserVault(
          owner,
          wrongStorage,
          new api.PinUnlock(async () => new TextEncoder().encode('999999')),
          new api.WebCryptoCipher(crypto),
        );
        let rejected = false;

        try {
          const unlocked = wrong.unlock(binding);

          await unlocked;
        } catch {
          rejected = wrong.state !== 'ready';
        }

        wrong.close();
        const correctStorage = await open();
        const correct = new api.BrowserVault(owner, correctStorage, source(), new api.WebCryptoCipher(crypto));

        await correct.unlock(binding);

        const afterFailure = await correct.open(context);
        const preserved = new TextDecoder().decode(afterFailure) === 'SYNTHETIC_OFFLINE_PIN_CONTENT';

        afterFailure.fill(0);
        correct.close();

        return { equal, sameIdentity, onlyCiphertext, rejected, preserved, discovered, wrongOwner, rosterFloor };
      },
      { vector },
    );

    expect(result).toEqual({
      equal: true,
      sameIdentity: true,
      onlyCiphertext: true,
      rejected: true,
      preserved: true,
      discovered: true,
      wrongOwner: 'corrupt',
      rosterFloor: true,
    });
  } finally {
    await page.close();
  }
});

it('binds PIN wrapping to context and wipes disposable PINs; rejects late derivation after cancellation', async () => {
  const page = await browser.newPage();

  try {
    await prepare(page);

    const result = await page.evaluate(
      async ({ vector, pinVector }) => {
        const { api } = (globalThis as FixtureWindow).fixtureModules;
        const binding = { ...vector.wrapped.context, method: api.pinMethod, methodId: pinVector.methodId };
        const supplied = new TextEncoder().encode(pinVector.pin);
        const unlock = new api.PinUnlock(async () => supplied);
        const secret = await unlock.secret(binding);
        const referenceMatches = api.encodeBytes(secret) === pinVector.secret;
        const cached = await unlock.secret(binding);
        const cachedMatches = api.encodeBytes(cached) === pinVector.secret;

        cached.fill(0);
        const cipher = new api.WebCryptoCipher(crypto);
        const wrapped = await cipher.wrap(secret, new Uint8Array(32).fill(3), binding);
        let substituted = false;

        try {
          await cipher.unwrap(secret, { ...binding, deviceId: crypto.randomUUID() }, wrapped);
        } catch {
          substituted = true;
        }

        secret.fill(0);
        unlock.cancel();
        const cleared = await unlock.secret(binding).then(
          () => 'accepted',
          (error) => error.code,
        );
        let deliver!: (pin: Uint8Array) => void;
        const delayed = new api.PinUnlock(
          () =>
            new Promise<Uint8Array>((resolve) => {
              deliver = resolve;
            }),
        );
        const pending = delayed.secret(binding).then(
          () => 'accepted',
          (error) => error.code,
        );

        delayed.cancel();
        const stale = new TextEncoder().encode('123456');

        deliver(stale);
        const code = await pending;
        const invalidPins = ['123', '0123', '01234', '0123456', '01234a', '０１２３４５'];
        const invalidResults = [];

        for (const value of invalidPins) {
          const bytes = new TextEncoder().encode(value);
          const invalid = new api.PinUnlock(async () => bytes);
          const inputCode = await invalid.secret(binding).then(
            () => 'accepted',
            (error) => error.code,
          );

          invalidResults.push({ inputCode, wiped: bytes.every((byte) => byte === 0) });
        }

        return {
          referenceMatches,
          cachedMatches,
          cleared,
          substituted,
          wiped: supplied.every((byte) => byte === 0),
          staleWiped: stale.every((byte) => byte === 0),
          code,
          invalidResults,
        };
      },
      { vector, pinVector },
    );

    expect(result).toEqual({
      referenceMatches: true,
      cachedMatches: true,
      cleared: 'pin-invalid',
      substituted: true,
      wiped: true,
      staleWiped: true,
      code: 'cancelled',
      invalidResults: Array(6).fill({ inputCode: 'pin-invalid', wiped: true }),
    });
  } finally {
    await page.close();
  }
});
