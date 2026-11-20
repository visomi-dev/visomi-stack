import { Readable } from 'node:stream';

import { beforeEach, expect, it, vi } from 'vitest';

import { createBackupObjects } from './s3-backup';

const fixture = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn() }));

vi.mock('@aws-sdk/client-s3', async (load) => {
  const real = await load<typeof import('@aws-sdk/client-s3')>();

  return {
    ...real,
    S3Client: class {
      send = fixture.send;
      destroy = fixture.destroy;
    },
  };
});

const env = {
  NODE_ENV: 'test',
  VISOMI_PERSISTENCE_EXAMPLE: 'true',
  VISOMI_PERSISTENCE_DEMOS: 'true',
  VISOMI_VAULT_BACKUP_S3_ENDPOINT: 'http://127.0.0.1:8333',
  VISOMI_VAULT_BACKUP_S3_ACCESS_KEY: 'synthetic',
  VISOMI_VAULT_BACKUP_S3_SECRET_KEY: 'synthetic',
  VISOMI_VAULT_BACKUP_S3_BUCKET: 'synthetic-bucket',
};

beforeEach(() => vi.clearAllMocks());

it.each([
  { VISOMI_PERSISTENCE_DEMOS: 'false' },
  { NODE_ENV: 'production' },
  { VISOMI_VAULT_BACKUP_S3_ENDPOINT: 'ftp://127.0.0.1/' },
  { VISOMI_VAULT_BACKUP_S3_ENDPOINT: 'https://example.test/' },
  { VISOMI_VAULT_BACKUP_S3_ENDPOINT: 'http://127.0.0.1/bucket' },
  { VISOMI_VAULT_BACKUP_S3_ACCESS_KEY: '' },
  { VISOMI_VAULT_BACKUP_S3_SECRET_KEY: '' },
  { VISOMI_VAULT_BACKUP_S3_BUCKET: '' },
  { VISOMI_VAULT_BACKUP_S3_BUCKET: 'not/a-bucket' },
])('rejects an invalid or non-isolated storage configuration', (override) => {
  expect(() => createBackupObjects({ ...env, ...override })).toThrow();
});

it('uses conditional writes and validates response length before returning any bytes', async () => {
  expect(createBackupObjects({})).toBeUndefined();
  const store = createBackupObjects(env)!;

  await store.put('fixture', 'encrypted');

  expect(fixture.send).toHaveBeenCalledWith(
    expect.objectContaining({ input: expect.objectContaining({ IfNoneMatch: '*' }) }),
    expect.anything(),
  );

  for (const response of [
    { ContentLength: 3 },
    { Body: Readable.from([Buffer.from('abc')]), ContentLength: 2 },
    { Body: Readable.from([Buffer.from('abcd')]), ContentLength: 3 },
    { Body: Readable.from([Buffer.from('ab')]), ContentLength: 3 },
  ]) {
    fixture.send.mockResolvedValueOnce(response);

    await expect(store.get('fixture', 3)).rejects.toMatchObject({ status: 503 });
  }

  fixture.send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('ab'), Buffer.from('c')]), ContentLength: 3 });

  await expect(store.get('fixture', 3)).resolves.toBe('abc');

  store.close();
  expect(fixture.destroy).toHaveBeenCalledOnce();
});
