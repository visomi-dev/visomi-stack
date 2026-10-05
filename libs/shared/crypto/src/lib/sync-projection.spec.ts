import { webcrypto } from 'node:crypto';

import { openSyncProjection, sealSyncProjection } from './sync-projection';
import type { ProjectionScope } from './sync-projection';
import type { ProjectionChange } from './client-sync';
import { mergeProjectionChanges } from './client-sync';

const crypto = webcrypto as unknown as Crypto;
const scope: ProjectionScope = { ownerUserId: 'owner', accountId: 'account', workspaceId: 'workspace' };
const change: ProjectionChange = {
  entityId: 'record',
  entityType: 'work',
  operation: 'upsert',
  revision: 1,
  envelopeId: 'encrypted-record',
  actorId: 'owner',
  value: { title: 'Private work item', effort: 3 },
};
const createdAt = '2026-10-04T12:00:00.000Z';

test('projection tombstones do not delete another entity type sharing the same identifier', () => {
  const merged = mergeProjectionChanges([
    { ...change, operation: 'delete' },
    { ...change, entityType: 'planning' },
  ]);

  expect(merged.work).toEqual([]);
  expect(merged.planning).toHaveLength(1);
});

test('round-trips portable projections with a non-extractable custody key without exposing plaintext', async () => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const envelope = await sealSyncProjection(crypto, key, scope, change, createdAt);

  expect(key.extractable).toBe(false);
  expect(JSON.stringify(envelope)).not.toContain('Private work item');
  await expect(openSyncProjection(crypto, key, scope, envelope)).resolves.toEqual(change);
});

test('rejects changed ordering, tombstones, scope, actor ciphertext and wrong keys', async () => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const wrongKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const envelope = await sealSyncProjection(crypto, key, scope, change, createdAt);

  for (const altered of [
    { ...envelope, revision: 2 },
    { ...envelope, envelopeId: 'substitute' },
    { ...envelope, createdAt: '2026-10-04T12:00:01.000Z' },
    { ...envelope, metadata: { ...envelope.metadata, tombstone: 'true' } },
    { ...envelope, workspaceId: 'other' },
    { ...envelope, associatedData: { ...envelope.associatedData, accountId: 'other' } },
    { ...envelope, ciphertext: (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1) },
  ])
    await expect(openSyncProjection(crypto, key, scope, altered)).rejects.toThrow();
  await expect(openSyncProjection(crypto, wrongKey, scope, envelope)).rejects.toThrow();
  await expect(openSyncProjection(crypto, key, { ...scope, ownerUserId: 'other' }, envelope)).rejects.toThrow();
});

test('authenticates deletion and rejects unsupported decrypted value shapes before encryption', async () => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const deletion: ProjectionChange = { ...change, operation: 'delete', value: undefined, revision: 2 };
  const envelope = await sealSyncProjection(crypto, key, scope, deletion, createdAt);

  expect(envelope.metadata['tombstone']).toBe('true');
  await expect(openSyncProjection(crypto, key, scope, envelope)).resolves.toEqual(deletion);
  await expect(
    sealSyncProjection(crypto, key, scope, { ...change, value: { invalid: NaN } }, createdAt),
  ).rejects.toThrow();
});
