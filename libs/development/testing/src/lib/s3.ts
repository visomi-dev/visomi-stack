import { setTimeout as delay } from 'node:timers/promises';

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

import { runTestCompose, type TestCompose } from './compose';

const accessKeyId = 'visomi_s3_test';
const secretAccessKey = 'synthetic-s3-test-password';

export const backupBucket = 'visomi-test-vault-backups';

export function backupS3Client(endpoint: string) {
  return new S3Client({
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    region: 'us-east-1',
    forcePathStyle: true,
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/** Uses the test PostgreSQL fixture's owned Compose project and disposable volume. */
export async function testBackupS3(compose: TestCompose) {
  await runTestCompose(compose, ['up', '-d', 'vault-s3']);

  const result = await runTestCompose(compose, ['port', 'vault-s3', '8333']);
  const port = /^(?:127\.0\.0\.1:)?(\d+)$/.exec(result.stdout.trim())?.[1];

  if (!port || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('isolated_s3_port_unavailable');
  }

  const endpoint = `http://127.0.0.1:${port}`;
  const s3 = backupS3Client(endpoint);

  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: backupBucket }), { abortSignal: AbortSignal.timeout(1_000) });

        break;
      } catch {
        if (attempt === 79) {
          throw new Error('isolated_s3_startup_timeout');
        }

        await delay(125);
      }
    }
  } finally {
    s3.destroy();
  }

  return {
    endpoint,
    environment: {
      VISOMI_VAULT_BACKUP_S3_ENDPOINT: endpoint,
      VISOMI_VAULT_BACKUP_S3_ACCESS_KEY: accessKeyId,
      VISOMI_VAULT_BACKUP_S3_SECRET_KEY: secretAccessKey,
      VISOMI_VAULT_BACKUP_S3_BUCKET: backupBucket,
    },
  };
}
