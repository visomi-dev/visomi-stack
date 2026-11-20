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

it('adds native PRF to a legacy PIN vault with the same key, bytes, generation and budget', async () => {
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
      async ({ vector, pinVector }) => {
        const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
        const name = crypto.randomUUID();
        const pin = {
          ...vector.wrapped.context,
          method: api.pinMethod,
          methodId: pinVector.methodId,
          origin: location.origin,
        };
        const unit = { ...vector.data.context, key: pin.key, target: pin.key.scope };
        const id = contracts.keyDomainId(pin.ownerId, pin.key);
        const unitId = contracts.vaultUnitId(pin.ownerId, unit);
        const text = new TextEncoder().encode('synthetic legacy note');
        const passkeyEnv = {
          origin: location.origin,
          rpId: location.hostname,
          credentials: navigator.credentials,
          crypto,
        };
        const cancellation = new AbortController().signal;
        const cipher = new api.WebCryptoCipher(crypto);
        const pinUnlock = () => new api.PinUnlock(async () => new TextEncoder().encode(pinVector.pin));
        const openStorage = () => api.IndexedDbVaultStorage.open(indexedDB, name, { localPasskeys: true });
        const code = (work: Promise<unknown>) =>
          work.then(
            () => 'accepted',
            (error) => error.code,
          );

        const legacy = await api.IndexedDbVaultStorage.open(indexedDB, name);
        const previous = new api.BrowserVault(pin.ownerId, legacy, pinUnlock(), cipher);

        await previous.initialize(pin);

        const encrypted = await previous.seal(unit, text);
        const original = await legacy.getKey(id);

        if (!original) {
          throw new Error('Legacy PIN wrapper missing');
        }

        previous.close();

        const storage = await openStorage();
        const pinVault = new api.BrowserVault(pin.ownerId, storage, pinUnlock(), cipher);
        const locked = await code(pinVault.addLocalPasskey('AQ', new api.PrfUnlock(passkeyEnv), cancellation));

        await pinVault.unlock(pin);

        const methodId = await api.createPrfCredential(passkeyEnv, cancellation);
        const passkey = await pinVault.addLocalPasskey(methodId, new api.PrfUnlock(passkeyEnv), cancellation);
        const budgetAfterAdd = await code(storage.reserveEncryption(id, 1));
        const second = await storage.localPasskeys!.get(id);
        const verifier = pinUnlock();

        if (!second) {
          throw new Error('PRF wrapper missing');
        }

        const secretA = await verifier.secret(pin);
        const secretB = await new api.PrfUnlock(passkeyEnv).secret(passkey);
        const rawA = await cipher.unwrap(secretA, pin, original);
        const rawB = await cipher.unwrap(secretB, passkey, second);
        const sameKey = rawA.every((byte, index) => byte === rawB[index]);

        for (const bytes of [secretA, secretB, rawA, rawB]) {
          bytes.fill(0);
        }
        verifier.cancel();
        pinVault.close();

        const prfStorage = await openStorage();
        const prfVault = new api.BrowserVault(pin.ownerId, prfStorage, new api.PrfUnlock(passkeyEnv), cipher);

        await prfVault.unlockLocalPasskey(passkey);

        const viaPrf = await prfVault.open(unit);

        await prfVault.encrypt(unit, text);

        const budgetAfterPrf = await code(prfStorage.reserveEncryption(id, 2));

        prfVault.close();

        const oldReader = await api.IndexedDbVaultStorage.open(indexedDB, name);
        const pinReader = new api.BrowserVault(pin.ownerId, oldReader, pinUnlock(), cipher);

        await pinReader.unlock(pin);

        const viaPin = await pinReader.open(unit);

        await pinReader.encrypt(unit, text);

        const budgetAfterPin = await code(oldReader.reserveEncryption(id, 3));
        const primary = await oldReader.getKey(id);
        const catalog = await oldReader.latestBindings(pin.ownerId);
        const unchanged = await oldReader.getUnit(unitId);
        const sameBinding =
          contracts.wrappingAad({ ...pin, method: 'passkey-prf', methodId }) === contracts.wrappingAad(passkey);

        pinReader.close();

        const forget = await openStorage();

        await forget.deleteKey(id);

        // Restoring the exact primary wrapper in this fixture must not revive its former alternate.
        await forget.putKey(id, original, true);

        const retainedAlternate = await forget.localPasskeys!.get(id);

        forget.close();

        return {
          locked,
          sameKey,
          sameBinding,
          sameCiphertext: JSON.stringify(encrypted) === JSON.stringify(unchanged),
          samePin: JSON.stringify(original) === JSON.stringify(primary),
          legacyCatalog: JSON.stringify(catalog) === JSON.stringify([pin]),
          sameNote: new TextDecoder().decode(viaPrf) === new TextDecoder().decode(viaPin),
          budget: [budgetAfterAdd, budgetAfterPrf, budgetAfterPin],
          alternateRemoved: retainedAlternate === undefined,
        };
      },
      { vector, pinVector },
    );

    expect(result).toEqual({
      locked: 'locked',
      sameKey: true,
      sameBinding: true,
      sameCiphertext: true,
      samePin: true,
      legacyCatalog: true,
      sameNote: true,
      budget: ['quota', 'quota', 'quota'],
      alternateRemoved: true,
    });
  } finally {
    await context.close();
  }
}, 60_000);

it('rolls back cancelled, failed, stale and concurrent local passkey additions', async () => {
  const page = await browser.newPage();

  try {
    await prepare(page);

    const result = await page.evaluate(
      async ({ vector, pinVector }) => {
        const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
        const name = crypto.randomUUID();
        const pin = { ...vector.wrapped.context, method: api.pinMethod, methodId: pinVector.methodId };
        const id = contracts.keyDomainId(pin.ownerId, pin.key);
        const unit = { ...vector.data.context, key: pin.key, target: pin.key.scope };
        const unitId = contracts.vaultUnitId(pin.ownerId, unit);
        const bytes = new TextEncoder().encode('synthetic unchanged note');
        const cipher = new api.WebCryptoCipher(crypto);
        const openStorage = () => api.IndexedDbVaultStorage.open(indexedDB, name, { localPasskeys: true });
        const pinUnlock = () => new api.PinUnlock(async () => new TextEncoder().encode(pinVector.pin));
        const mockPrf = (value: number) => ({
          secret: async () => new Uint8Array(32).fill(value),
          cancel: () => undefined,
        });
        const code = (work: Promise<unknown>) =>
          work.then(
            () => 'accepted',
            (error) => error.code,
          );
        const forever = new AbortController().signal;
        const storage = await openStorage();
        const vault = new api.BrowserVault(pin.ownerId, storage, pinUnlock(), cipher);

        await vault.initialize(pin);

        const before = await vault.seal(unit, bytes);
        const original = await storage.getKey(id);

        if (!original) {
          throw new Error('Original PIN wrapper missing');
        }

        const failures: string[] = [];

        for (const failure of ['cancelled', 'unsupported-prf', 'unavailable'] as const) {
          const simulated = {
            secret: async () => {
              throw new contracts.VaultError(failure);
            },
            cancel: () => undefined,
          };
          const status = await code(vault.addLocalPasskey('AQ', simulated, forever));

          failures.push(status);
        }

        let complete!: (secret: Uint8Array) => void;
        const late = new Promise<Uint8Array>((resolve) => {
          complete = resolve;
        });
        const pending = code(vault.addLocalPasskey('AQ', { secret: () => late, cancel: () => undefined }, forever));

        vault.lock();
        const disposable = new Uint8Array(32).fill(17);

        complete(disposable);
        const locked = await pending;

        await vault.unlock(pin);

        // Fire cancellation on the native write request before the IndexedDB transaction commits.
        const logout = new AbortController();
        const add = IDBObjectStore.prototype.add;
        let wrote = false;

        IDBObjectStore.prototype.add = function (value: { id?: string }, key?: IDBValidKey) {
          const request = add.call(this, value, key);

          if (value.id?.startsWith('local-passkey:')) {
            request.addEventListener(
              'success',
              () => {
                wrote = true;
                logout.abort();
              },
              { once: true },
            );
          }

          return request;
        };
        let rolledBack: string;

        try {
          const result = await code(vault.addLocalPasskey('AQ', mockPrf(1), logout.signal));

          rolledBack = result;
        } finally {
          IDBObjectStore.prototype.add = add;
        }

        IDBObjectStore.prototype.add = function (value: { id?: string }, key?: IDBValidKey) {
          if (value.id?.startsWith('local-passkey:')) {
            throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
          }

          return add.call(this, value, key);
        };

        let quota: string;

        try {
          const result = await code(vault.addLocalPasskey('AQ', mockPrf(1), forever));

          quota = result;
        } finally {
          IDBObjectStore.prototype.add = add;
        }

        const pendingWrapper = await storage.localPasskeys!.get(id);
        const otherStorage = await openStorage();
        const other = new api.BrowserVault(pin.ownerId, otherStorage, pinUnlock(), cipher);

        await other.unlock(pin);

        const cancelledBeforeCommit = [locked, rolledBack];
        const concurrent = await Promise.all([
          code(vault.addLocalPasskey('AQ', mockPrf(1), forever)),
          code(other.addLocalPasskey('Ag', mockPrf(2), forever)),
        ]);

        const enrolled = await storage.localPasskeys!.get(id);

        if (!enrolled) {
          throw new Error('Winning enrollment not persisted');
        }

        const foreign = await code(
          storage.localPasskeys!.add(
            original,
            { ...enrolled, context: { ...enrolled.context, deviceId: crypto.randomUUID() } },
            forever,
          ),
        );
        const primary = await storage.getKey(id);
        const after = await storage.getUnit(unitId);
        const budget = await code(storage.reserveEncryption(id, 1));

        vault.close();
        other.close();

        return {
          absent: pendingWrapper === undefined,
          wrote,
          wiped: disposable.every((byte) => byte === 0),
          failures,
          cancelledBeforeCommit,
          quota,
          concurrent: concurrent.sort(),
          foreign,
          preserved:
            JSON.stringify(primary) === JSON.stringify(original) && JSON.stringify(after) === JSON.stringify(before),
          budget,
          winner: ['AQ', 'Ag'].includes(enrolled.context.methodId),
        };
      },
      { vector, pinVector },
    );

    expect(result).toEqual({
      absent: true,
      wrote: true,
      wiped: true,
      failures: ['cancelled', 'unsupported-prf', 'unavailable'],
      cancelledBeforeCommit: ['stale-operation', 'cancelled'],
      quota: 'quota',
      concurrent: ['accepted', 'revision-conflict'],
      foreign: 'corrupt',
      preserved: true,
      budget: 'quota',
      winner: true,
    });
  } finally {
    await page.close();
  }
}, 60_000);
