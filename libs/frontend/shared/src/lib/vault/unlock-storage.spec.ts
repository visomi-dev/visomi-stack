import { IDBFactory, IDBObjectStore, IDBVersionChangeEvent } from 'fake-indexeddb';

import { localUnlockRecord, UnlockStorage } from './unlock-storage';
import type { LocalUnlockRecord } from './unlock-storage';

const owner = '11111111-1111-4111-8111-111111111111';
const scope = '22222222-2222-4222-8222-222222222222';
const browser = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const locks = {
  request: async (_name: string, operation: () => Promise<unknown>) => operation(),
} as unknown as LockManager;

function record(browserId = browser, ownerUserId = owner, personalScopeId = scope): LocalUnlockRecord {
  return localUnlockRecord.parse({
    envelope: {
      version: 1,
      kdfProfile: 'pin-argon2id-hkdf-sha256-v1',
      binding: {
        ownerUserId,
        personalScopeId,
        methodId: other,
        methodKind: 'local-pin',
        browserId,
        keyGeneration: 1,
      },
      hkdfSalt: 'A'.repeat(43),
      argon2Salt: 'A'.repeat(22),
      iv: 'A'.repeat(16),
      ciphertext: 'A'.repeat(64),
    },
    consent: true,
    failures: 0,
    cooldownUntil: 0,
  });
}

async function seed(factory: IDBFactory, inputs: LocalUnlockRecord[]): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('visomi-vault-unlock', 1);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('methods', 'readwrite');

      for (const input of inputs) {
        const binding = input.envelope.binding;

        tx.objectStore('methods').put(input, [binding.ownerUserId, binding.personalScopeId, binding.browserId]);
      }

      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

test('persists across instances and replaces and removes only the owner and scope partition', async () => {
  const factory = new IDBFactory();
  const storage = new UnlockStorage(factory, locks);

  await storage.replace(record());
  await storage.replace(record(browser, other));
  await storage.replace(record(browser, owner, other));
  const reopened = new UnlockStorage(factory, locks);

  await expect(reopened.read(owner, scope)).resolves.toEqual(record());
  await reopened.replace(record(other));
  await expect(reopened.read(owner, scope)).resolves.toEqual(record(other));
  await reopened.remove(owner, scope);
  await expect(reopened.read(owner, scope)).resolves.toBeNull();
  await expect(reopened.read(other, scope)).resolves.toEqual(record(browser, other));
  await expect(reopened.read(owner, other)).resolves.toEqual(record(browser, owner, other));
});

test('rejects missing consent, invalid counters and secret fields without overwriting a method', async () => {
  const storage = new UnlockStorage(new IDBFactory(), locks);
  const original = record();

  await storage.replace(original);
  for (const input of [
    { ...original, consent: false },
    { ...original, failures: 11 },
    { ...original, failures: -1 },
    { ...original, cooldownUntil: -1 },
    { ...original, cooldownUntil: 1.5 },
    { ...original, pin: '029471' },
    { ...original, envelope: { ...original.envelope, rawKey: 'secret' } },
  ]) {
    await expect(storage.replace(input as unknown as LocalUnlockRecord)).rejects.toThrow();
  }

  await expect(storage.read(owner, scope)).resolves.toEqual(original);
});

test('rejects invalid partitions before touching storage or taking a lock', async () => {
  const factory = new IDBFactory();
  const open = jest.spyOn(factory, 'open');
  const request = jest.fn();
  const storage = new UnlockStorage(factory, { request } as unknown as LockManager);

  await expect(storage.read('invalid', scope)).rejects.toThrow();
  await expect(storage.remove(owner, 'invalid')).rejects.toThrow();
  await expect(storage.exclusive('invalid', scope, async () => undefined)).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

test('fails closed for duplicate methods and malformed persisted records', async () => {
  const factory = new IDBFactory();
  const storage = new UnlockStorage(factory, locks);

  await storage.replace(record());
  await seed(factory, [record(other)]);
  await expect(storage.read(owner, scope)).rejects.toThrow('local_unlock_conflict');
  await storage.replace(record());
  await seed(factory, [{ ...record(), pin: 'secret' } as unknown as LocalUnlockRecord]);
  await expect(storage.read(owner, scope)).rejects.toThrow();
  await expect(storage.replace(record(other))).rejects.toThrow();
  await expect(storage.remove(owner, scope)).rejects.toThrow();
});

test('propagates unavailable storage and incompatible versions without resetting the database', async () => {
  const unavailable = {
    open: () => {
      throw new DOMException('Denied', 'SecurityError');
    },
  } as unknown as IDBFactory;

  await expect(new UnlockStorage(unavailable, locks).read(owner, scope)).rejects.toThrow('Denied');
  const factory = new IDBFactory();
  const storage = new UnlockStorage(factory, locks);

  await storage.replace(record());
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const upgrade = factory.open('visomi-vault-unlock', 2);

    upgrade.onsuccess = () => resolve(upgrade.result);
    upgrade.onerror = () => reject(upgrade.error);
  });

  db.close();
  await expect(storage.read(owner, scope)).rejects.toThrow('local_unlock_storage_unavailable');
});

test('quota failure after deleting an old method rolls back the entire replacement', async () => {
  const storage = new UnlockStorage(new IDBFactory(), locks);

  await storage.replace(record());
  const put = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
    throw new DOMException('Quota exhausted', 'QuotaExceededError');
  });

  try {
    await expect(storage.replace(record(other))).rejects.toThrow('Quota exhausted');
  } finally {
    put.mockRestore();
  }

  await expect(storage.read(owner, scope)).resolves.toEqual(record());
});

test('rejects blocked opens and closes a connection that succeeds after rejection', async () => {
  const close = jest.fn();
  const request = {
    result: { close, onversionchange: null },
    onblocked: null,
    onsuccess: null,
  } as unknown as IDBOpenDBRequest;
  const factory = { open: () => request } as unknown as IDBFactory;
  const pending = new UnlockStorage(factory, locks).read(owner, scope);
  const rejection = expect(pending).rejects.toThrow('local_unlock_storage_blocked');

  request.onblocked?.call(request, new IDBVersionChangeEvent('blocked'));
  await rejection;
  request.onsuccess?.call(request, new Event('success'));
  expect(close).toHaveBeenCalledTimes(1);
});

test('propagates asynchronous write aborts and preserves the previous method', async () => {
  const storage = new UnlockStorage(new IDBFactory(), locks);

  await storage.replace(record());
  const originalPut = IDBObjectStore.prototype.put;
  const put = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    const request = originalPut.call(this, value, key);

    this.transaction.abort();

    return request;
  });

  try {
    await expect(storage.replace(record(other))).rejects.toThrow('local_unlock_storage_unavailable');
  } finally {
    put.mockRestore();
  }

  await expect(storage.read(owner, scope)).resolves.toEqual(record());
});

test('uses a stable partition lock and propagates operation and lock failures', async () => {
  const request = jest.fn(locks.request);
  const storage = new UnlockStorage(new IDBFactory(), { request } as unknown as LockManager);

  await expect(storage.exclusive(owner, scope, async () => 42)).resolves.toBe(42);
  expect(request).toHaveBeenCalledWith(`visomi-vault-unlock:${owner}:${scope}`, expect.any(Function));
  await expect(
    storage.exclusive(owner, scope, async () => {
      throw new Error('operation failed');
    }),
  ).rejects.toThrow('operation failed');
  request.mockRejectedValueOnce(new Error('lock unavailable'));
  await expect(storage.exclusive(owner, scope, async () => 42)).rejects.toThrow('lock unavailable');
});
