import { setTimeout as delay } from 'node:timers/promises';

import { S3Client } from '@bradenmacdonald/s3-lite-client';

import { runTestCompose, type TestCompose } from './compose';

const accessKey = 'visomi_s3_test';
const secretKey = 'synthetic-s3-test-password';

export const backupBucket = 'visomi-test-vault-backups';

export function backupS3Client(endpoint: string) {
  const url = new URL(endpoint);

  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.href !== `${url.origin}/`) {
    throw new Error('isolated_s3_endpoint_invalid');
  }

  const client = new S3Client({
    endPoint: url.origin,
    accessKey,
    secretKey,
    bucket: backupBucket,
    region: 'us-east-1',
    pathStyle: true,
  });

  return async (method: 'GET' | 'PUT', key: string, body?: string, timeout = 4_000) => {
    const signal = AbortSignal.timeout(timeout);
    const signed = await client.getPresignedUrl(method, key, { expirySeconds: 15 });
    const response = await fetch(signed, { method, body, redirect: 'error', signal });

    if (response.status !== 200) {
      await response.body?.cancel();

      throw new Error('isolated_s3_request_failed');
    }

    return response;
  };
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
  const request = backupS3Client(endpoint);

  for (let attempt = 0; ; attempt++) {
    try {
      // A signed write also proves that the configured private bucket has been created.
      const response = await request('PUT', 'fixture-readiness', 'ready', 1_000);

      await response.body?.cancel();

      break;
    } catch {
      if (attempt === 79) {
        throw new Error('isolated_s3_startup_timeout');
      }

      await delay(125);
    }
  }

  return {
    endpoint,
    environment: {
      VISOMI_VAULT_BACKUP_S3_ENDPOINT: endpoint,
      VISOMI_VAULT_BACKUP_S3_ACCESS_KEY: accessKey,
      VISOMI_VAULT_BACKUP_S3_SECRET_KEY: secretKey,
      VISOMI_VAULT_BACKUP_S3_BUCKET: backupBucket,
    },
  };
}
