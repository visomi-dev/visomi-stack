import { S3Client } from '@bradenmacdonald/s3-lite-client';
import type { BackupObjects } from '@visomi-stack/backend-db';
import { HttpError } from '@visomi-stack/web-backend-shared';

export function createBackupObjects(environment: NodeJS.ProcessEnv): BackupObjects | undefined {
  const endpoint = environment['VISOMI_VAULT_BACKUP_S3_ENDPOINT'];
  const accessKey = environment['VISOMI_VAULT_BACKUP_S3_ACCESS_KEY'];
  const secretKey = environment['VISOMI_VAULT_BACKUP_S3_SECRET_KEY'];
  const bucket = environment['VISOMI_VAULT_BACKUP_S3_BUCKET'];

  if (
    !endpoint ||
    !URL.canParse(endpoint) ||
    !accessKey ||
    !secretKey ||
    !bucket ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)
  ) {
    return undefined;
  }

  const url = new URL(endpoint);
  const localHttp =
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    ['test', 'development'].includes(environment['NODE_ENV'] ?? '');

  if (url.href !== `${url.origin}/` || (url.protocol !== 'https:' && !localHttp)) {
    return undefined;
  }

  const client = new S3Client({
    endPoint: url.origin,
    pathStyle: true,
    bucket,
    accessKey,
    secretKey,
    region: 'us-east-1',
  });

  async function request(method: 'PUT' | 'GET' | 'DELETE', key: string, body?: string) {
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(key)) {
      throw new HttpError(503, 'vault_backup_unavailable');
    }

    const signal = AbortSignal.timeout(4_000);
    const headers: Record<string, string> = { 'accept-encoding': 'identity' };

    if (method === 'PUT') {
      headers['content-type'] = 'application/json';
      headers['if-none-match'] = '*';
    }

    // Keep the short-lived signature server-side. Native fetch controls cancellation and redirects.
    const signed = await client.getPresignedUrl(method, key, { expirySeconds: 15, extraHeaders: headers });
    const destination = new URL(signed);

    if (destination.origin !== url.origin || destination.pathname !== `/${bucket}/${key}`) {
      throw new HttpError(503, 'vault_backup_unavailable');
    }

    const response = await fetch(destination, { method, headers, body, signal, redirect: 'error' });

    if (response.status !== (method === 'DELETE' ? 204 : 200)) {
      await response.body?.cancel();

      throw new HttpError(503, 'vault_backup_unavailable');
    }

    return response;
  }

  return {
    async delete(key) {
      const response = await request('DELETE', key);

      await response.body?.cancel();
    },
    async put(key, body) {
      const response = await request('PUT', key, body);

      await response.body?.cancel();
    },
    async get(key, bytes) {
      const response = await request('GET', key);
      const stream = response.body;

      if (!stream) {
        throw new HttpError(503, 'vault_backup_unavailable');
      }

      const reader = stream.getReader();

      try {
        const encoding = response.headers.get('content-encoding') ?? 'identity';

        if (encoding !== 'identity' || response.headers.get('content-length') !== String(bytes)) {
          throw new HttpError(503, 'vault_backup_unavailable');
        }

        const chunks: Uint8Array[] = [];
        let length = 0;

        for (;;) {
          const result = await reader.read();

          if (result.done) {
            break;
          }

          length += result.value.length;

          if (length > bytes) {
            throw new HttpError(503, 'vault_backup_unavailable');
          }

          chunks.push(result.value);
        }

        if (length !== bytes) {
          throw new HttpError(503, 'vault_backup_unavailable');
        }

        return Buffer.concat(chunks, length).toString('utf8');
      } finally {
        await reader.cancel().catch(() => undefined);

        reader.releaseLock();
      }
    },
    // Native fetch owns its connections.
    close: () => undefined,
  };
}
