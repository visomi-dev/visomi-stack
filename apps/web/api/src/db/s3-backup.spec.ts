import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { S3Client } from '@bradenmacdonald/s3-lite-client';
import { afterEach, expect, it, vi } from 'vitest';

import { createBackupObjects } from './s3-backup';

const env = {
  NODE_ENV: 'test',
  VISOMI_VAULT_BACKUP_S3_ENDPOINT: 'http://127.0.0.1:8333',
  VISOMI_VAULT_BACKUP_S3_ACCESS_KEY: 'synthetic',
  VISOMI_VAULT_BACKUP_S3_SECRET_KEY: 'synthetic',
  VISOMI_VAULT_BACKUP_S3_BUCKET: 'synthetic-bucket',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  { VISOMI_VAULT_BACKUP_S3_ENDPOINT: undefined },
  { VISOMI_VAULT_BACKUP_S3_ENDPOINT: 'not an origin' },
  { NODE_ENV: 'production' },
  { NODE_ENV: undefined },
  { VISOMI_VAULT_BACKUP_S3_ENDPOINT: 'ftp://127.0.0.1/' },
  { VISOMI_VAULT_BACKUP_S3_ENDPOINT: 'http://example.test/' },
  { VISOMI_VAULT_BACKUP_S3_ENDPOINT: 'http://127.0.0.1/bucket' },
  { VISOMI_VAULT_BACKUP_S3_ENDPOINT: 'https://example.test/?secret=synthetic' },
  { VISOMI_VAULT_BACKUP_S3_ACCESS_KEY: '' },
  { VISOMI_VAULT_BACKUP_S3_SECRET_KEY: '' },
  { VISOMI_VAULT_BACKUP_S3_BUCKET: '' },
  { VISOMI_VAULT_BACKUP_S3_BUCKET: 'not/a-bucket' },
])('leaves missing or unsafe object storage unavailable', (override) => {
  expect(createBackupObjects({ ...env, ...override })).toBeUndefined();
});

it('signs conditional writes on the configured HTTPS origin in production', async () => {
  const request = vi.fn<typeof fetch>();
  const timeouts = vi.spyOn(AbortSignal, 'timeout');

  vi.stubGlobal('fetch', request);
  request.mockResolvedValueOnce(new Response(''));
  const storage = createBackupObjects({
    ...env,
    NODE_ENV: 'production',
    VISOMI_VAULT_BACKUP_S3_ENDPOINT: 'https://objects.example.test',
  })!;

  await storage.put('vault-backups/scope/object', 'encrypted');

  await expect(storage.put('../other-bucket/file', 'encrypted')).rejects.toMatchObject({ status: 503 });

  expect(request).toHaveBeenCalledOnce();
  expect(timeouts).toHaveBeenCalledExactlyOnceWith(4_000);
  const [destination, init] = request.mock.calls[0];

  expect(destination).toMatchObject({
    origin: 'https://objects.example.test',
    pathname: '/synthetic-bucket/vault-backups/scope/object',
  });
  expect((destination as URL).searchParams.get('X-Amz-SignedHeaders')).toContain('if-none-match');
  expect((destination as URL).searchParams.get('X-Amz-Expires')).toBe('15');
  expect(init).toMatchObject({
    method: 'PUT',
    body: 'encrypted',
    redirect: 'error',
    headers: { 'if-none-match': '*' },
  });
  storage.close();
});

it.each(['https://outside.example.test/synthetic-bucket/fixture', 'http://127.0.0.1:8333/other-bucket/fixture'])(
  'rejects a signed destination outside the configured object path',
  async (destination) => {
    vi.spyOn(S3Client.prototype, 'getPresignedUrl').mockResolvedValueOnce(destination);
    const request = vi.fn<typeof fetch>();

    vi.stubGlobal('fetch', request);

    await expect(createBackupObjects(env)!.get('fixture', 3)).rejects.toMatchObject({ status: 503 });

    expect(request).not.toHaveBeenCalled();
  },
);

it('signs fixed-origin staging cleanup and requires a successful S3 delete', async () => {
  const request = vi.fn<typeof fetch>();
  const storage = createBackupObjects(env)!;

  vi.stubGlobal('fetch', request);
  request.mockResolvedValueOnce(new Response(null, { status: 204 }));
  request.mockResolvedValueOnce(new Response(null, { status: 403 }));

  await expect(storage.delete('vault-backups/scope/abandoned')).resolves.toBeUndefined();

  await expect(storage.delete('vault-backups/scope/abandoned')).rejects.toMatchObject({ status: 503 });

  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      origin: 'http://127.0.0.1:8333',
      pathname: '/synthetic-bucket/vault-backups/scope/abandoned',
    }),
    expect.objectContaining({ method: 'DELETE', redirect: 'error', signal: expect.any(AbortSignal) }),
  );
});

it('verifies response status, encoding, and bounded streaming before returning bytes', async () => {
  const request = vi.fn<typeof fetch>();
  const storage = createBackupObjects(env)!;

  vi.stubGlobal('fetch', request);

  for (const response of [
    new Response(null, { status: 503 }),
    new Response('', { status: 412 }),
    new Response(null),
    new Response('abc', { headers: { 'content-length': '2' } }),
    new Response('abc', { headers: { 'content-length': '3', 'content-encoding': 'gzip' } }),
    new Response('abcd', { headers: { 'content-length': '3' } }),
    new Response('ab', { headers: { 'content-length': '3' } }),
  ]) {
    request.mockResolvedValueOnce(response);

    await expect(storage.get('fixture', 3)).rejects.toMatchObject({ status: 503 });
  }

  request.mockResolvedValueOnce(
    new Response('abc', { headers: { 'content-length': '3', 'content-encoding': 'identity' } }),
  );

  await expect(storage.get('fixture', 3)).resolves.toBe('abc');

  const interrupted = new Error('synthetic stream interrupted');
  const broken = new ReadableStream<Uint8Array>({ pull: (controller) => controller.error(interrupted) });

  request.mockResolvedValueOnce(new Response(broken, { headers: { 'content-length': '3' } }));

  await expect(storage.get('fixture', 3)).rejects.toBe(interrupted);

  expect(request).toHaveBeenCalledTimes(9);
});

it('rejects redirects and aborts an in-progress download on the transport deadline', async () => {
  const redirected = vi.fn();
  let streaming!: () => void;
  const started = new Promise<void>((resolve) => {
    streaming = resolve;
  });
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/redirected')) {
      redirected();
      response.end();

      return;
    }

    if (request.url?.startsWith('/synthetic-bucket/redirect')) {
      response.writeHead(307, { Location: '/redirected' }).end();

      return;
    }

    response.writeHead(200, { 'content-length': '3' }).write('a', streaming);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address() as AddressInfo;
  const storage = createBackupObjects({ ...env, VISOMI_VAULT_BACKUP_S3_ENDPOINT: `http://127.0.0.1:${address.port}` })!;

  try {
    await expect(storage.put('redirect', 'ciphertext')).rejects.toThrow();

    expect(redirected).not.toHaveBeenCalled();

    const deadline = new AbortController();
    const deadlineSignal = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
    const request = storage.get('slow', 3);
    const assertion = expect(request).rejects.toThrow();

    await started;

    deadline.abort(new Error('synthetic deadline expired'));

    await assertion;

    expect(deadlineSignal).toHaveBeenCalledWith(4_000);
  } finally {
    server.closeAllConnections();

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
