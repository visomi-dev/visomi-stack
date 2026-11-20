import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { backupBucket, backupS3Client, testBackupS3 } from '../s3';

import { runTestCompose, type TestCompose } from './compose';

vi.mock('./compose', () => ({ runTestCompose: vi.fn() }));
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

const fetchFixture = vi.fn<typeof fetch>();
const owner: TestCompose = {
  provider: 'docker',
  project: 'visomi-auth-test-owned',
  directory: '/synthetic/visomi-auth-test-owned',
  telemetryDirectory: '/synthetic/telemetry',
  app: 'web-api',
};

beforeEach(() => {
  fetchFixture.mockReset();
  vi.stubGlobal('fetch', fetchFixture);
  vi.mocked(runTestCompose).mockReset().mockResolvedValue({ stdout: '127.0.0.1:8555\n', stderr: '' });
});

afterEach(() => vi.unstubAllGlobals());

it('waits for a private test bucket under the existing fixture owner', async () => {
  fetchFixture.mockResolvedValueOnce(new Response('starting', { status: 503 })).mockResolvedValueOnce(new Response(''));

  await expect(testBackupS3(owner)).resolves.toMatchObject({
    endpoint: 'http://127.0.0.1:8555',
    environment: { PRIVATE_S3_BUCKET: backupBucket },
  });

  expect(runTestCompose).toHaveBeenNthCalledWith(1, owner, ['up', '-d', 'vault-s3']);
  expect(runTestCompose).toHaveBeenNthCalledWith(2, owner, ['port', 'vault-s3', '8333']);
  expect(fetchFixture).toHaveBeenCalledTimes(2);
  const [signed, init] = fetchFixture.mock.calls[0];
  const url = new URL(String(signed));

  expect(url.origin).toBe('http://127.0.0.1:8555');
  expect(url.pathname).toBe(`/${backupBucket}/fixture-readiness`);
  expect(init).toMatchObject({ method: 'PUT', body: 'ready', redirect: 'error' });
});

it('uses single-attempt streamed reads and rejects failed responses', async () => {
  const request = backupS3Client('http://127.0.0.1:8555');

  fetchFixture
    .mockResolvedValueOnce(new Response('original'))
    .mockResolvedValueOnce(new Response(null, { status: 403 }));

  const response = await request('GET', 'a');
  const text = await response.text();

  expect(text).toBe('original');

  await expect(request('GET', 'b')).rejects.toThrow('isolated_s3_request_failed');

  expect(fetchFixture).toHaveBeenCalledTimes(2);
});

it.each(['https://127.0.0.1:8333', 'http://example.test', 'http://127.0.0.1/elsewhere'])(
  'rejects a fixture endpoint outside its fixed loopback origin',
  (endpoint) => {
    expect(() => backupS3Client(endpoint)).toThrow('isolated_s3_endpoint_invalid');
  },
);

it.each(['0.0.0.0:8333', '0', '65536'])('rejects an invalid port reported by Compose (%s)', async (stdout) => {
  vi.mocked(runTestCompose).mockResolvedValue({ stdout, stderr: '' });

  await expect(testBackupS3(owner)).rejects.toThrow('isolated_s3_port_unavailable');

  expect(fetchFixture).not.toHaveBeenCalled();
});

it('bounds retries if the private bucket is never ready', async () => {
  fetchFixture.mockRejectedValue(new Error('bucket unavailable'));

  await expect(testBackupS3(owner)).rejects.toThrow('isolated_s3_startup_timeout');

  expect(fetchFixture).toHaveBeenCalledTimes(80);
});
