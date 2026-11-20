import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { beforeEach, expect, it, vi } from 'vitest';

import { backupBucket, testBackupS3 } from '../s3';

import { runTestCompose, type TestCompose } from './compose';

const { send, destroy } = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn() }));

vi.mock('@aws-sdk/client-s3', async (load) => {
  const sdk = await load<typeof import('@aws-sdk/client-s3')>();

  return {
    ...sdk,
    S3Client: class {
      send = send;
      destroy = destroy;
    },
  };
});
vi.mock('./compose', () => ({ runTestCompose: vi.fn() }));
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

const owner: TestCompose = {
  provider: 'docker',
  project: 'visomi-auth-test-owned',
  directory: '/synthetic/visomi-auth-test-owned',
  telemetryDirectory: '/synthetic/telemetry',
  app: 'web-api',
};

beforeEach(() => {
  send.mockReset();
  destroy.mockClear();
  vi.mocked(runTestCompose).mockReset().mockResolvedValue({ stdout: '127.0.0.1:8555\n', stderr: '' });
});

it('waits for the private test bucket under the existing fixture owner', async () => {
  send.mockRejectedValueOnce(new Error('bucket starting')).mockResolvedValueOnce({});

  await expect(testBackupS3(owner)).resolves.toMatchObject({
    endpoint: 'http://127.0.0.1:8555',
    environment: { VISOMI_VAULT_BACKUP_S3_BUCKET: backupBucket },
  });

  expect(runTestCompose).toHaveBeenNthCalledWith(1, owner, ['up', '-d', 'vault-s3']);
  expect(runTestCompose).toHaveBeenNthCalledWith(2, owner, ['port', 'vault-s3', '8333']);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.lastCall?.[0]).toBeInstanceOf(HeadBucketCommand);
  expect(send.mock.lastCall?.[0].input).toEqual({ Bucket: backupBucket });
  expect(destroy).toHaveBeenCalledOnce();
});

it.each(['0.0.0.0:8333', '0', '65536'])('rejects an invalid port reported by Compose (%s)', async (stdout) => {
  vi.mocked(runTestCompose).mockResolvedValue({ stdout, stderr: '' });

  await expect(testBackupS3(owner)).rejects.toThrow('isolated_s3_port_unavailable');

  expect(send).not.toHaveBeenCalled();
});

it('bounds retries and closes the client if the bucket is never ready', async () => {
  send.mockRejectedValue(new Error('bucket unavailable'));

  await expect(testBackupS3(owner)).rejects.toThrow('isolated_s3_startup_timeout');

  expect(send).toHaveBeenCalledTimes(80);
  expect(destroy).toHaveBeenCalledOnce();
});
