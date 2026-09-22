import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { restoreMinioImage, restoreObjectCanary, verifyOwnedObjectStore } from './restore-objects.ts';

function memoryStore() {
  const objects = new Map<string, Uint8Array>();

  return {
    objects,
    async get(key: string) {
      return objects.get(key);
    },
    async put(key: string, value: Uint8Array) {
      objects.set(key, Uint8Array.from(value));
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
}

test('object proof restores only encrypted backup bytes after deleting the source; backups are private and removed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'object-proof-test-'));
  const source = memoryStore();
  const destination = memoryStore();
  const put = destination.put;
  let backupVerified = false;

  destination.put = async (key, body) => {
    assert.equal(source.objects.size, 0);
    const backupDirectory = join(directory, (await readdir(directory))[0]);
    const path = join(backupDirectory, 'canary.encrypted');

    assert.equal((await stat(backupDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await readFile(path), Buffer.from(body));
    assert.deepEqual(Object.keys(JSON.parse(Buffer.from(body).toString())).sort(), [
      'ciphertext',
      'nonce',
      'tag',
      'version',
    ]);
    backupVerified = true;
    await put(key, body);
  };
  try {
    const result = await restoreObjectCanary(source, destination, directory);

    assert.equal(backupVerified, true);
    assert.equal(result.authenticatedDecryption, true);
    assert.equal(result.missingKeyRejected, true);
    assert.equal(result.wrongKeyRejected, true);
    assert.equal(result.clientKeyStorage, 'runner-memory-only');
    assert.match(result.ciphertextSha256, /^[a-f0-9]{64}$/);
    assert.equal(source.objects.size + destination.objects.size, 0);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const mode of ['corrupted', 'missing'] as const)
  test(`${mode} destination fails and cleans both stores and the local backup`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'object-proof-test-'));
    const source = memoryStore();
    const destination = memoryStore();
    const put = destination.put;

    destination.put = async (key, body) => {
      if (mode === 'missing') return;
      const corrupted = Uint8Array.from(body);

      corrupted[0] ^= 1;
      await put(key, corrupted);
    };
    try {
      await assert.rejects(restoreObjectCanary(source, destination, directory), /bytes or hash differ/);
      assert.equal(source.objects.size + destination.objects.size, 0);
      assert.deepEqual(await readdir(directory), []);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

test('an occupied canary key is rejected without overwriting or deleting pre-existing objects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'object-proof-test-'));
  const source = memoryStore();
  const destination = memoryStore();

  await source.put('restore-canary-v1', Buffer.from('existing fixture'));
  try {
    await assert.rejects(restoreObjectCanary(source, destination, directory), /must be empty/);
    assert.equal(Buffer.from((await source.get('restore-canary-v1'))!).toString(), 'existing fixture');
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('owned MinIO verification uses the repository SigV4 adapter, separate buckets and loopback only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'object-proof-test-'));
  const objects = new Map<string, Uint8Array>();
  const buckets = new Set<string>();
  let signedRequests = 0;
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));

    assert.equal(url.origin, 'http://127.0.0.1:19001');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    if (url.pathname === '/minio/health/ready') return new Response(null, { status: 200 });
    const headers = new Headers(init?.headers);

    assert.match(headers.get('authorization') ?? '', /^AWS4-HMAC-SHA256 Credential=fixture-access\//);
    assert.match(headers.get('x-amz-content-sha256') ?? '', /^[a-f0-9]{64}$/);
    signedRequests += 1;
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts.length === 1) {
      buckets.add(parts[0]);

      return new Response(null, { status: 200 });
    }
    if (init?.method === 'PUT') {
      assert.ok(init.body instanceof Uint8Array);
      const body = Uint8Array.from(init.body);

      assert.deepEqual(Object.keys(JSON.parse(Buffer.from(body).toString())).sort(), [
        'ciphertext',
        'nonce',
        'tag',
        'version',
      ]);
      objects.set(url.pathname, body);

      return new Response(null, { status: 200 });
    }
    if (init?.method === 'DELETE') {
      objects.delete(url.pathname);

      return new Response(null, { status: 204 });
    }
    const body = objects.get(url.pathname);

    return body ? new Response(Buffer.from(body)) : new Response(null, { status: 404 });
  };

  try {
    const result = await verifyOwnedObjectStore(19001, 'fixture-access', 'fixture-secret', directory, transport);

    assert.equal(result.authenticatedDecryption, true);
    assert.equal(buckets.size, 2);
    assert.ok([...buckets].some((bucket) => bucket.startsWith('source-')));
    assert.ok([...buckets].some((bucket) => bucket.startsWith('restored-')));
    assert.ok(signedRequests >= 8);
    assert.equal(objects.size, 0);
    assert.deepEqual(await readdir(directory), []);
    assert.equal(restoreMinioImage, 'quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z');
    assert.ok(!JSON.stringify(result).includes('fixture-secret'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
