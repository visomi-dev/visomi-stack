import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';

import { IndexedDbSyncStateStore } from './indexed-db-sync-state';

import { BrowserSyncAdapter } from 'shared-crypto';
import type { SyncState, OpaqueSyncTransport } from 'shared-crypto';

const locks = {
  request: async (_name: string, operation: () => Promise<unknown>) => operation(),
} as unknown as LockManager;
const state: SyncState = { cursor: { workspaceId: 'workspace-a', value: 2 }, queue: [], tombstones: ['deleted'] };

test('persists partitioned state across reopen without sharing users or workspaces', async () => {
  const factory = new IDBFactory();
  const store = new IndexedDbSyncStateStore(factory, locks, 'owner', 'workspace-a');

  await store.save(state);
  await expect(new IndexedDbSyncStateStore(factory, locks, 'owner', 'workspace-a').load()).resolves.toEqual(state);
  await expect(new IndexedDbSyncStateStore(factory, locks, 'other', 'workspace-a').load()).resolves.toBeUndefined();
  await expect(new IndexedDbSyncStateStore(factory, locks, 'owner', 'workspace-b').load()).resolves.toBeUndefined();
});

test('rejects cursor regressions, wrong partitions and plaintext or PIN data without overwriting state', async () => {
  const store = new IndexedDbSyncStateStore(new IDBFactory(), locks, 'owner', 'workspace-a');

  await store.save(state);
  await expect(store.save({ ...state, cursor: { workspaceId: 'workspace-a', value: 1 } })).rejects.toThrow(
    'cursor_regression',
  );
  await expect(store.save({ ...state, cursor: { workspaceId: 'other', value: 2 } })).rejects.toThrow();
  await expect(store.save({ ...state, pin: '029471' } as unknown as SyncState)).rejects.toThrow();
  await expect(
    store.save({ ...state, queue: [{ envelope: 'plaintext', attempts: 0, nextAttemptAt: 0 }] }),
  ).rejects.toThrow();
  await expect(store.load()).resolves.toEqual(state);
});

test('preserves persisted state on quota failures', async () => {
  const store = new IndexedDbSyncStateStore(new IDBFactory(), locks, 'owner', 'workspace-a');

  await store.save(state);
  const put = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
    throw new DOMException('Quota exhausted', 'QuotaExceededError');
  });

  try {
    await expect(store.save({ ...state, tombstones: [] })).rejects.toThrow('Quota exhausted');
  } finally {
    put.mockRestore();
  }

  await expect(store.load()).resolves.toEqual(state);
});

test('adapter uses the cross-tab lock and propagates unavailable locks without writing', async () => {
  const request = jest.fn(locks.request);
  const store = new IndexedDbSyncStateStore(
    new IDBFactory(),
    { request } as unknown as LockManager,
    'owner',
    'workspace-a',
  );
  const transport: OpaqueSyncTransport = {
    append: async () => ({ cursor: 1, duplicate: false }),
    list: async () => [],
  };
  const adapter = new BrowserSyncAdapter('workspace-a', transport, store);

  await adapter.initialize();
  expect(request).toHaveBeenCalledWith('visomi-encrypted-sync:["owner","workspace-a"]', expect.any(Function));
  request.mockRejectedValueOnce(new Error('Lock unavailable'));
  await expect(adapter.flush()).rejects.toThrow('Lock unavailable');
  await expect(store.load()).resolves.toBeUndefined();
});
