import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IndexedDbReplicaStorage, encodeBytes } from '@visomi-stack/web-shared-vault';
import { dataEnvelopeSchema, syncCheckpointMessage, type WrappingContext } from '@visomi-stack/shared-persistence';

import { Session } from '../auth/session/session';

import { ExamplePrivateResource } from './example-private-resource';
import { PersistenceHttp } from './http';
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
    unit: vi.fn(async () => envelope),
    pending: vi.fn(async () => undefined),
    close: vi.fn(),
  };

  vi.spyOn(IndexedDbReplicaStorage, 'open').mockResolvedValue(storage as unknown as IndexedDbReplicaStorage);
  const vault = {
    localBinding: vi.fn(async () => binding),
    connect: vi.fn(async () => undefined),
    device: vi.fn(async () => ({ publicKeys: async () => keys, lock: vi.fn() })),
    ready: signal(true),
    readEnvelope: vi.fn(async () => undefined),
    clearDisplay: vi.fn(),
    lock: vi.fn(),
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
      { provide: PersistenceHttp, useValue: api },
      { provide: VaultSession, useValue: vault },
    ],
  });

  return {
    resource: TestBed.inject(ExamplePrivateResource),
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
