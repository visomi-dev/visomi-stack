import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';

import { IndexedDbProjections } from './indexed-db-projections';

import type { EncryptedEnvelope } from 'shared-crypto';

const scope = { ownerUserId: 'owner', accountId: 'account', workspaceId: 'workspace' };
const envelope: EncryptedEnvelope = {
  format: 'themis.encrypted-envelope',
  version: 1,
  kind: 'sync-object',
  envelopeId: 'record',
  workspaceId: scope.workspaceId,
  recordType: 'projection',
  revision: 1,
  createdAt: '2026-10-04T12:00:00.000Z',
  associatedData: { ownerUserId: scope.ownerUserId, accountId: scope.accountId },
  metadata: {},
  nonce: 'bm9uY2U',
  ciphertext: 'Y2lwaGVydGV4dA',
  authTag: 'dGFn',
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: IDBKeyRange });
});

test('commits ciphertext before reopening, deduplicates exact replay and isolates every ownership dimension', async () => {
  const factory = new IDBFactory();
  const store = new IndexedDbProjections(factory, scope);

  await store.apply([envelope, envelope]);
  await expect(new IndexedDbProjections(factory, scope).list()).resolves.toEqual([envelope]);
  for (const partition of [
    { ...scope, ownerUserId: 'other' },
    { ...scope, accountId: 'other' },
    { ...scope, workspaceId: 'other' },
  ])
    await expect(new IndexedDbProjections(factory, partition).list()).resolves.toEqual([]);
  await expect(store.apply([{ ...envelope, workspaceId: 'other' }])).rejects.toThrow('scope_mismatch');
  await expect(store.apply([{ ...envelope, plaintext: 'secret' } as unknown as EncryptedEnvelope])).rejects.toThrow();
});

test('revision substitution rolls the entire batch back and quota failures preserve committed records', async () => {
  const store = new IndexedDbProjections(new IDBFactory(), scope);

  await store.apply([envelope]);
  await expect(
    store.apply([
      { ...envelope, revision: 2 },
      { ...envelope, ciphertext: 'YWx0ZXJlZA' },
    ]),
  ).rejects.toThrow('revision_conflict');
  await expect(store.list()).resolves.toEqual([envelope]);
  const spy = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
    throw new Error('quota');
  });

  try {
    await expect(store.apply([{ ...envelope, revision: 2 }])).rejects.toThrow('quota');
  } finally {
    spy.mockRestore();
  }
  await expect(store.list()).resolves.toEqual([envelope]);
});

test('cancellation never persists a departing-generation batch', async () => {
  const store = new IndexedDbProjections(new IDBFactory(), scope);
  const controller = new AbortController();

  controller.abort();
  await expect(store.apply([envelope], controller.signal)).rejects.toThrow();
  await expect(store.list()).resolves.toEqual([]);
});
