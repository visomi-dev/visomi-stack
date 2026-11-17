import { expect, it } from 'vitest';

import { browser, prepare, vector, type FixtureWindow } from './support/browser';

it('opens native version-one ciphertext databases without upgrading or resetting pins, outboxes or encryption budgets', async () => {
  const page = await browser.newPage();

  try {
    await prepare(page);

    const result = await page.evaluate(
      async ({ vector }) => {
        const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
        const owner = vector.wrapped.context.ownerId;
        const cipher = new api.WebCryptoCipher(crypto);
        const wrapped = await cipher.wrap(
          new Uint8Array(32).fill(2),
          new Uint8Array(32).fill(3),
          vector.wrapped.context,
        );
        const key = await cipher.importDataKey(new Uint8Array(32).fill(3));
        const envelope = await cipher.seal(
          key,
          vector.data.context,
          new TextEncoder().encode('Synthetic encrypted local state'),
        );
        const keyId = contracts.keyDomainId(owner, wrapped.context.key);
        const unitId = contracts.vaultUnitId(owner, envelope.context);
        const operationId = contracts.createOperationId(crypto);
        const pending = {
          protocol: 1 as const,
          operationId,
          expectedRevision: 0,
          head: { cursor: 0, checkpoint: null },
          envelope,
          authorization: {
            key: envelope.context.key,
            deviceId: wrapped.context.deviceId,
            operationId,
            epoch: 1,
            action: 'sync' as const,
            bodyHash: api.encodeBytes(new Uint8Array(32)),
            signature: api.encodeBytes(new Uint8Array(64)),
          },
        };
        const pin = { cursor: 7, checkpoint: api.encodeBytes(new Uint8Array(32).fill(9)), generation: 3, epoch: 4 };
        const create = (name: string, vault: boolean) =>
          new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(name, 1);

            request.onupgradeneeded = () => {
              for (const store of vault ? ['keys', 'units'] : ['pins', 'units', 'outbox']) {
                request.result.createObjectStore(store, vault ? { keyPath: 'id' } : undefined);
              }
            };
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
        const nativeVault = await create(`visomi-vault:${owner}`, true);
        const nativeReplica = await create(`visomi-sync:${owner}`, false);

        await new Promise<void>((resolve, reject) => {
          const tx = nativeVault.transaction(['keys', 'units'], 'readwrite');

          tx.objectStore('keys').put({ id: keyId, envelope: wrapped, used: 1_048_575 });
          tx.objectStore('units').put({ id: unitId, envelope });
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });

        await new Promise<void>((resolve, reject) => {
          const tx = nativeReplica.transaction(['pins', 'units', 'outbox'], 'readwrite');

          tx.objectStore('pins').put(pin, 'synthetic-stream');
          tx.objectStore('units').put(envelope, JSON.stringify(['synthetic-stream', envelope.context.objectId]));
          tx.objectStore('outbox').put({ value: pending, seen: false }, 'synthetic-stream');
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });

        const vault = await api.IndexedDbVaultStorage.open(indexedDB, owner);
        const second = await api.IndexedDbVaultStorage.open(indexedDB, owner);
        const replica = await api.IndexedDbReplicaStorage.open(indexedDB, owner);
        const restoredKey = await vault.getCurrentKey(owner, wrapped.context.key);
        const restoredUnit = await vault.getUnit(unitId);
        const restoredPin = await replica.pin('synthetic-stream');
        const restoredPending = await replica.pending('synthetic-stream');
        const restoredReplica = await replica.unit('synthetic-stream', envelope.context.objectId);
        const reservations = await Promise.allSettled([
          vault.reserveEncryption(keyId, 1_048_576),
          second.reserveEncryption(keyId, 1_048_576),
        ]);
        let unverifiedAck = '';

        try {
          await replica.acknowledged('synthetic-stream', operationId);
        } catch (error) {
          unverifiedAck = (error as { code: string }).code;
        }

        const afterAck = await replica.pending('synthetic-stream');
        const versions = [nativeVault.version, nativeReplica.version];

        vault.close();
        second.close();
        replica.close();
        nativeVault.close();
        nativeReplica.close();

        return {
          versions,
          key: restoredKey?.ciphertext === wrapped.ciphertext,
          unit: restoredUnit?.ciphertext === envelope.ciphertext,
          pin: JSON.stringify(restoredPin) === JSON.stringify(pin),
          pending: JSON.stringify(restoredPending) === JSON.stringify(pending),
          replica: restoredReplica?.ciphertext === envelope.ciphertext,
          reservations: reservations
            .map((entry) => (entry.status === 'fulfilled' ? 'committed' : entry.reason.code))
            .sort(),
          unverifiedAck,
          preserved: JSON.stringify(afterAck) === JSON.stringify(pending),
        };
      },
      { vector },
    );

    expect(result).toEqual({
      versions: [1, 1],
      key: true,
      unit: true,
      pin: true,
      pending: true,
      replica: true,
      reservations: ['committed', 'quota'],
      unverifiedAck: 'corrupt',
      preserved: true,
    });
  } finally {
    await page.close();
  }
}, 60_000);

it.each([1, 2])(
  'rejects incompatible native v%i without changing its schema or contents',
  async (version) => {
    const page = await browser.newPage();

    try {
      await prepare(page);

      const result = await page.evaluate(async (version) => {
        const { api } = (globalThis as FixtureWindow).fixtureModules;
        const owner = crypto.randomUUID();
        const name = `visomi-vault:${owner}`;
        const native = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name, version);

          request.onupgradeneeded = () =>
            request.result.createObjectStore('keys', { keyPath: 'id' }).put({ id: 'synthetic-retained', marker: true });
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        let code = '';

        try {
          await api.IndexedDbVaultStorage.open(indexedDB, owner);
        } catch (error) {
          code = (error as { code: string }).code;
        }

        const retained = await new Promise<unknown>((resolve, reject) => {
          const request = native.transaction('keys').objectStore('keys').get('synthetic-retained');

          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const result = { code, version: native.version, stores: Array.from(native.objectStoreNames), retained };

        native.close();

        return result;
      }, version);

      expect(result).toEqual({
        code: 'unavailable',
        version,
        stores: ['keys'],
        retained: { id: 'synthetic-retained', marker: true },
      });
    } finally {
      await page.close();
    }
  },
  60_000,
);

it('closes on a version change without account-bearing console output or implicit reopening', async () => {
  const page = await browser.newPage();
  const messages: string[] = [];

  page.on('console', (message) => messages.push(message.text()));

  try {
    await prepare(page);

    const result = await page.evaluate(async () => {
      const { api } = (globalThis as FixtureWindow).fixtureModules;
      const owner = crypto.randomUUID();
      const storage = await api.IndexedDbVaultStorage.open(indexedDB, owner);
      const native = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(`visomi-vault:${owner}`, 2);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      let code = '';

      try {
        await storage.getKey('synthetic-retained');
      } catch (error) {
        code = (error as { code: string }).code;
      }

      native.close();
      storage.close();

      return { owner, code };
    });

    expect(result.code).toBe('unavailable');
    expect(messages.join('\n')).not.toContain(result.owner);
  } finally {
    await page.close();
  }
}, 60_000);
