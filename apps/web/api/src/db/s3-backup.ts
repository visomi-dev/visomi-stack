import { addAbortSignal, Readable } from 'node:stream';

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { BackupObjects } from '@visomi-stack/backend-db';
import { developmentPersistenceDemos } from '@visomi-stack/shared-db';
import { HttpError } from '@visomi-stack/web-backend-shared';

export function createBackupObjects(environment: NodeJS.ProcessEnv): BackupObjects | undefined {
  const endpoint = environment['VISOMI_VAULT_BACKUP_S3_ENDPOINT'];

  if (endpoint === undefined) {
    return undefined;
  }

  const url = new URL(endpoint);
  const accessKeyId = environment['VISOMI_VAULT_BACKUP_S3_ACCESS_KEY'];
  const secretAccessKey = environment['VISOMI_VAULT_BACKUP_S3_SECRET_KEY'];
  const bucket = environment['VISOMI_VAULT_BACKUP_S3_BUCKET'];

  if (
    !developmentPersistenceDemos(environment) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.href !== `${url.origin}/` ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucket ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)
  ) {
    throw new Error('vault_backup_configuration_invalid');
  }

  const client = new S3Client({
    endpoint: url.origin,
    credentials: { accessKeyId, secretAccessKey },
    region: 'us-east-1',
    forcePathStyle: true,
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return {
    async put(key, body) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: 'application/json',
          IfNoneMatch: '*',
        }),
        { abortSignal: AbortSignal.timeout(4_000) },
      );
    },
    async get(key, bytes) {
      const signal = AbortSignal.timeout(4_000);
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: signal,
      });
      const stream = response.Body;

      if (!(stream instanceof Readable)) {
        throw new HttpError(503, 'vault_backup_unavailable');
      }

      try {
        addAbortSignal(signal, stream);

        if (response.ContentLength !== bytes) {
          throw new HttpError(503, 'vault_backup_unavailable');
        }

        const chunks: Buffer[] = [];
        let length = 0;

        for await (const chunk of stream as AsyncIterable<Buffer>) {
          length += chunk.length;

          if (length > bytes) {
            throw new HttpError(503, 'vault_backup_unavailable');
          }

          chunks.push(chunk);
        }

        if (length !== bytes) {
          throw new HttpError(503, 'vault_backup_unavailable');
        }

        return Buffer.concat(chunks, length).toString('utf8');
      } finally {
        stream.destroy();
      }
    },
    close: () => client.destroy(),
  };
}
