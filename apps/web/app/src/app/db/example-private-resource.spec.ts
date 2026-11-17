import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { encodeBytes } from '@visomi-stack/web-frontend-db';
import { IndexedDbReplicaStorage } from '@visomi-stack/web-frontend-db/storage';
import { dataEnvelopeSchema, syncCheckpointMessage, type WrappingContext } from '@visomi-stack/shared-db';

import { Session } from '../auth/session/session';

import { ExamplePrivateResource } from './example-private-resource';
import { DatabaseHttp } from './http';
import { VaultSession } from './vault-session';

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

async function fixture(generation = 1, schemaVersion = 1) {
  const target = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    scopeId: '22222222-2222-4222-8222-222222222222',
    objectId: '33333333-3333-4333-8333-333333333333',
  };
  const binding: WrappingContext = {
    key: {
      product: 'synthetic-example',
      domain: 'private-resources',
      scope: { kind: 'resource', tenantId: target.tenantId, groupId: null, resourceId: target.scopeId },
      generation: 2,
    },
    ownerId: '44444444-4444-4444-8444-444444444444',
    deviceId: '55555555-5555-4555-8555-555555555555',
    method: 'passkey-prf',
    methodId: 'AQ',
    origin: 'https://synthetic.example.test',
  };
  const envelope = dataEnvelopeSchema.parse({
    format: 'visomi.data',
    version: 1,
    algorithm: 'A256GCM',
    nonce: encodeBytes(new Uint8Array(12)),
    ciphertext: encodeBytes(new Uint8Array(17)),
    context: {
      key: { ...binding.key, generation },
      target: binding.key.scope,
      objectId: target.objectId,
      schemaVersion,
      revision: 1,
      kind: 'record',
      previousCheckpoint: null,
    },
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(syncCheckpointMessage(1, null, envelope)),
  );
  const checkpoint = encodeBytes(new Uint8Array(digest));
  const keys = { signing: 'synthetic-signing', encryption: 'synthetic-encryption' };
  const initial = { cursor: 0, checkpoint: null, generation: 1, epoch: 1 };
  const commit = vi.fn(async () => undefined);
  const storage = {
    pin: vi.fn(async () => initial),
    commit,
    advanceControl: vi.fn(async (_id: string, minimum: { epoch: number; generation: number }) => {
      initial.epoch = Math.max(initial.epoch, minimum.epoch);
      initial.generation = Math.max(initial.generation, minimum.generation);
    }),
    unit: vi.fn(async () => envelope),
    pending: vi.fn(async () => undefined),
    close: vi.fn(),
  };

  vi.spyOn(IndexedDbReplicaStorage, 'open').mockResolvedValue(storage as unknown as IndexedDbReplicaStorage);
  const vault = {
    localBinding: vi.fn(async () => binding),
    localLatestBinding: vi.fn(async () => binding),
    canResume: vi.fn(() => true),
    isOpen: vi.fn(() => true),
    connect: vi.fn(async () => undefined),
    device: vi.fn(async () => ({ publicKeys: async () => keys, lock: vi.fn() })),
    ready: signal(true),
    readEnvelope: vi.fn(async () => undefined),
    clearDisplay: vi.fn(),
    lock: vi.fn(),
    lockContext: vi.fn(),
    release: vi.fn(),
  };
  const api = {
    request: vi.fn(async (path: string) =>
      path.endsWith('/devices')
        ? {
            key: binding.key,
            epoch: 3,
            phase: 'ready',
            devices: [{ id: binding.deviceId, ownerId: binding.ownerId, ...keys, revokedAt: null }],
          }
        : {
            protocol: 1,
            generation: Math.max(2, generation),
            epoch: 3,
            phase: 'ready',
            head: { cursor: 1, checkpoint },
            events: [{ cursor: 1, checkpoint, previousCheckpoint: null, envelope }],
            more: false,
          },
    ),
  };

  TestBed.configureTestingModule({
    providers: [
      ExamplePrivateResource,
      {
        provide: Session,
        useValue: {
          user: signal({ id: binding.ownerId }),
          full: signal(true),
          operationVersion: signal(0),
          cancellation: () => new AbortController().signal,
        },
      },
      { provide: DOCUMENT, useValue: { defaultView: { crypto, indexedDB: {} } } },
      { provide: DatabaseHttp, useValue: api },
      { provide: VaultSession, useValue: vault },
    ],
  });

  return {
    resource: TestBed.inject(ExamplePrivateResource),
    api,
    storage,
    target,
    binding,
    envelope,
    vault,
    commit,
    initial,
    checkpoint,
  };
}

it('authenticates and displays an authorized historical generation while retaining the current writing binding', async () => {
  const f = await fixture();

  await f.resource.unlock(f.target, 'synthetic.example.test', false);

  expect(f.vault.connect).toHaveBeenCalledWith(f.binding, 'synthetic.example.test', false);
  expect(f.vault.readEnvelope).toHaveBeenCalledWith(f.envelope, false);
  expect(f.vault.readEnvelope).toHaveBeenCalledWith(f.envelope);
  expect(f.commit).toHaveBeenCalledWith(
    expect.any(String),
    f.initial,
    { cursor: 1, checkpoint: f.checkpoint, generation: 2, epoch: 3 },
    [expect.objectContaining({ envelope: f.envelope })],
  );

  expect(f.resource.synchronized()).toBe(true);
});

it.each([
  { generation: 3, schema: 1, code: 'corrupt' },
  { generation: 1, schema: 2, code: 'unsupported-version' },
])(
  'preserves explicit rejection of an unavailable generation or schema: $code',
  async ({ generation, schema, code }) => {
    const f = await fixture(generation, schema);

    await expect(f.resource.unlock(f.target, 'synthetic.example.test', false)).rejects.toMatchObject({ code });

    expect(f.vault.readEnvelope).not.toHaveBeenCalled();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.resource.synchronized()).toBe(false);
  },
);

it('rejects a late binding lookup before it can reconnect an obsolete vault', async () => {
  const f = await fixture();
  let resolve!: (value: WrappingContext) => void;

  f.vault.localBinding.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const old = f.resource.unlock(f.target, 'synthetic.example.test', false);
  const rejected = expect(old).rejects.toMatchObject({ code: 'stale-operation' });

  await vi.waitFor(() => expect(f.vault.localBinding).toHaveBeenCalledTimes(1));

  f.resource.close();
  resolve(f.binding);

  await rejected;

  expect(f.vault.connect).not.toHaveBeenCalled();
  expect(f.commit).not.toHaveBeenCalled();
});

it('rejects every operation for an object other than the explicitly unlocked target', async () => {
  const f = await fixture();

  await f.resource.unlock(f.target, 'synthetic.example.test', false);

  const target = { ...f.target, objectId: '66666666-6666-4666-8666-666666666666' };
  const calls = f.api.request.mock.calls.length;

  for (const action of [
    () => f.resource.save(target, 'Wrong object'),
    () => f.resource.synchronize(target),
    () => f.resource.keepPending(target),
    () => f.resource.useSynchronized(target),
  ]) {
    await expect(action()).rejects.toMatchObject({ code: 'stale-operation' });
  }

  expect(f.api.request.mock.calls).toHaveLength(calls);
});

it('does not resume an old save after another object is unlocked in the same scope', async () => {
  const f = await fixture();

  await f.resource.unlock(f.target, 'synthetic.example.test', false);

  let resolve!: (value: undefined) => void;

  f.storage.pending.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const old = f.resource.save(f.target, 'Old private draft');
  const rejected = expect(old).rejects.toMatchObject({ code: 'stale-operation' });

  f.resource.close();
  f.storage.unit.mockResolvedValueOnce(undefined as never);

  await f.resource.unlock(
    { ...f.target, objectId: '66666666-6666-4666-8666-666666666666' },
    'synthetic.example.test',
    false,
  );

  const reads = f.vault.readEnvelope.mock.calls.length;

  resolve(undefined);

  await rejected;

  expect(f.vault.readEnvelope.mock.calls).toHaveLength(reads);
  expect(f.resource.pending()).toBe(false);
  expect(f.resource.synchronized()).toBe(true);
});

it('restores an already opened local scope for its new view without any roster or synchronization request', async () => {
  const f = await fixture();

  await f.resource.resume(f.target, 'synthetic.example.test');

  expect(f.api.request).not.toHaveBeenCalled();
  expect(f.vault.canResume).toHaveBeenCalledWith(f.binding);
  expect(f.vault.connect).toHaveBeenCalledWith(f.binding, 'synthetic.example.test', false, undefined);
  expect(f.vault.readEnvelope).toHaveBeenCalledWith(f.envelope);
  f.resource.close();
  expect(f.vault.lock).not.toHaveBeenCalled();
  expect(f.storage.close).toHaveBeenCalled();
});

it('rejects a late navigation resume before it can replace the target or reconnect custody', async () => {
  const f = await fixture();
  let finish!: (value: WrappingContext) => void;

  f.vault.localLatestBinding.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.resource.resume(f.target, 'synthetic.example.test');
  const rejected = expect(pending).rejects.toMatchObject({ code: 'stale-operation' });

  f.resource.close();
  finish(f.binding);

  await rejected;

  expect(f.vault.connect).not.toHaveBeenCalled();
  expect(f.api.request).not.toHaveBeenCalled();
});

it('retains the authorized roster epoch and generation through navigation before the first sync page arrives', async () => {
  const f = await fixture();
  const request = f.api.request.getMockImplementation()!;
  let finish!: (page: Awaited<ReturnType<typeof request>>) => void;
  const delayed = new Promise<Awaited<ReturnType<typeof request>>>((resolve) => {
    finish = resolve;
  });

  f.api.request.mockImplementation((path) => (path.endsWith('/sync/pull') ? delayed : request(path)));
  const opening = f.resource.unlock(f.target, 'synthetic.example.test', false);
  const canceled = expect(opening).rejects.toMatchObject({ code: 'stale-operation' });

  await vi.waitFor(() => expect(f.api.request.mock.calls.some(([path]) => path.endsWith('/sync/pull'))).toBe(true));

  expect(f.initial.epoch).toBe(3);
  expect(f.commit).not.toHaveBeenCalled();
  f.resource.close();

  await f.resource.resume(f.target, 'synthetic.example.test');

  f.api.request.mockImplementation(async (path) => {
    const page = await request(path);

    return { ...page, epoch: 2 };
  });

  await expect(f.resource.synchronize(f.target)).rejects.toMatchObject({ code: 'context-mismatch' });

  expect(f.commit).not.toHaveBeenCalled();
  expect(f.initial).toEqual({ cursor: 0, checkpoint: null, generation: 2, epoch: 3 });

  const page = await request('/sync/pull');

  finish(page);

  await canceled;
});

it('invalidates cached custody when the authorized roster no longer approves its device', async () => {
  const f = await fixture();

  f.api.request.mockResolvedValueOnce({ key: f.binding.key, epoch: 3, phase: 'ready', devices: [] });

  await expect(f.resource.unlock(f.target, 'synthetic.example.test', false)).rejects.toMatchObject({
    code: 'recovery-required',
  });

  expect(f.vault.lockContext).toHaveBeenCalledWith(f.binding);
  expect(f.commit).not.toHaveBeenCalled();
});
