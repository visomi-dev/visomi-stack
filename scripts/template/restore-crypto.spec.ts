import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  createProtectedTotpFixture,
  decryptCanary,
  decryptTotpFixture,
  encryptCanary,
  proveKeyBoundary,
} from './restore-crypto.ts';

test('client canary is authenticated ciphertext and rejects missing, wrong and tampered keys/data', () => {
  const key = randomBytes(32);
  const plaintext = Buffer.from('synthetic-client-plaintext-must-not-be-uploaded');
  const envelope = encryptCanary(plaintext, key);

  assert.ok(!envelope.includes(plaintext));
  assert.ok(!envelope.includes(key));
  assert.deepEqual(Object.keys(JSON.parse(envelope.toString())).sort(), ['ciphertext', 'nonce', 'tag', 'version']);
  assert.deepEqual(
    proveKeyBoundary((candidate) => decryptCanary(envelope, candidate), key, plaintext),
    {
      authenticatedDecryption: true,
      missingKeyRejected: true,
      wrongKeyRejected: true,
    },
  );
  const tampered = JSON.parse(envelope.toString()) as { tag: string };
  const tag = Buffer.from(tampered.tag, 'base64url');

  tag[0] ^= 1;
  tampered.tag = tag.toString('base64url');
  assert.throws(() => decryptCanary(Buffer.from(JSON.stringify(tampered)), key), /authentication failed/);
  key.fill(0);
});

test('negative-key proof fails closed when an implementation accepts any key', () => {
  assert.throws(
    () => proveKeyBoundary(() => Buffer.from('fixture'), randomBytes(32), Buffer.from('fixture')),
    /accepted an unavailable or incorrect key/,
  );
});

test('server TOTP fixture reopens a separate protected key file and cleans it up', () => {
  const directory = mkdtempSync(join(tmpdir(), 'totp-proof-test-'));
  const fixture = createProtectedTotpFixture(directory);

  try {
    const keyDirectory = join(directory, readdirSync(directory)[0]);
    const path = join(keyDirectory, 'server-key');

    assert.equal(statSync(keyDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const secret = readFileSync(path);

    assert.match(decryptTotpFixture(fixture.encryptedSecret, secret).toString(), /^[A-Z2-7]{32}$/);
    assert.ok(!fixture.encryptedSecret.includes(secret.toString('base64url')));
    assert.deepEqual(fixture.verify(fixture.encryptedSecret), {
      authenticatedDecryption: true,
      missingKeyRejected: true,
      wrongKeyRejected: true,
    });
    assert.throws(() => fixture.verify('1.corrupt.fixture.record'), /ciphertext differs/);
    unlinkSync(path);
    assert.throws(() => fixture.verify(fixture.encryptedSecret));
    fixture.cleanup();
    assert.deepEqual(readdirSync(directory), []);
    secret.fill(0);
  } finally {
    fixture.cleanup();
    rmSync(directory, { recursive: true, force: true });
  }
});
