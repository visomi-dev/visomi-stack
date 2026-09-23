import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// This standalone bundled tool reuses the pure SigV4 adapter without loading the
// shared application barrel (which initializes ambient application configuration).
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  RailwayS3ObjectStore,
  type OpaqueObjectStore,
} from '../../libs/backend/shared/src/lib/crypto/opaque-sync-object-store.ts';

import { decryptCanary, encryptCanary, proveKeyBoundary } from './restore-crypto.ts';

export const restoreMinioImage = 'quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z';

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function restoreObjectCanary(
  source: OpaqueObjectStore,
  destination: OpaqueObjectStore,
  directory: string,
) {
  const privateDirectory = await mkdtemp(join(directory, 'object-backup-'));
  const backupPath = join(privateDirectory, 'canary.encrypted');
  const key = randomBytes(32);
  const plaintext = randomBytes(96);
  const objectKey = 'restore-canary-v1';
  let sourceWritten = false;
  let destinationWritten = false;

  try {
    await chmod(privateDirectory, 0o700);
    if ((await source.get(objectKey)) || (await destination.get(objectKey)))
      throw new Error('Canary stores must be empty.');
    const encrypted = encryptCanary(plaintext, key);

    sourceWritten = true;
    await source.put(objectKey, encrypted);
    const downloaded = await source.get(objectKey);

    if (!downloaded || !Buffer.from(downloaded).equals(encrypted)) throw new Error('Canary source bytes differ.');
    await writeFile(backupPath, downloaded, { mode: 0o600, flag: 'wx' });
    await source.delete(objectKey);
    if (await source.get(objectKey)) throw new Error('Canary source removal failed.');
    const backup = await readFile(backupPath);

    destinationWritten = true;
    await destination.put(objectKey, backup);
    const restored = await destination.get(objectKey);

    if (!restored || !Buffer.from(restored).equals(encrypted) || hash(restored) !== hash(encrypted))
      throw new Error('Restored canary bytes or hash differ.');
    const proof = proveKeyBoundary((candidate) => decryptCanary(restored, candidate), key, plaintext);

    return {
      scope: 'synthetic-encrypted-object-canary' as const,
      ciphertextSha256: hash(restored),
      restoredBytesMatch: true as const,
      sourceRemovedBeforeRestore: true as const,
      clientKeyStorage: 'runner-memory-only' as const,
      ...proof,
    };
  } finally {
    key.fill(0);
    plaintext.fill(0);
    // Attempt all cleanup even when one S3 deletion fails. Container teardown is
    // the outer fallback and removes both buckets, credentials and object data.
    await Promise.allSettled([
      sourceWritten ? source.delete(objectKey) : Promise.resolve(),
      destinationWritten ? destination.delete(objectKey) : Promise.resolve(),
    ]);
    await rm(privateDirectory, { recursive: true, force: true });
  }
}

export async function verifyOwnedObjectStore(
  port: number,
  accessKey: string,
  secretKey: string,
  directory: string,
  transport: typeof fetch = fetch,
) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid disposable object-store port.');
  // Caller supplies only the port of its newly created task-owned container.
  // Never accept an endpoint or credentials from ambient production variables.
  const endpoint = `http://127.0.0.1:${port}`;
  const fetcher: typeof fetch = (input, init) =>
    transport(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  let ready = false;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      ready = (await fetcher(`${endpoint}/minio/health/ready`)).ok;
    } catch {
      /* Bootstrap may still be pending. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Disposable object store did not become ready.');
  const nonce = randomBytes(8).toString('hex');
  const source = new RailwayS3ObjectStore({ endpoint, accessKey, secretKey, bucket: `source-${nonce}` }, fetcher);
  const destination = new RailwayS3ObjectStore(
    { endpoint, accessKey, secretKey, bucket: `restored-${nonce}` },
    fetcher,
  );

  try {
    await source.ensureBucket();
    await destination.ensureBucket();

    return await restoreObjectCanary(source, destination, directory);
  } catch {
    throw new Error('Disposable encrypted object recovery proof failed.');
  }
}
