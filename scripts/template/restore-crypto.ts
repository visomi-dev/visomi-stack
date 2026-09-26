import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const aad = Buffer.from('visomi-restore-canary:v1');

export function encryptCanary(plaintext: Uint8Array, key: Uint8Array): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);

  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Buffer.from(
    JSON.stringify({
      version: 1,
      nonce: nonce.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    }),
  );
}

export function decryptCanary(envelope: Uint8Array, key?: Uint8Array): Buffer {
  try {
    if (!key || key.byteLength !== 32) throw new Error();
    const parsed: unknown = JSON.parse(Buffer.from(envelope).toString('utf8'));

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('nonce' in parsed) ||
      typeof parsed.nonce !== 'string' ||
      !('tag' in parsed) ||
      typeof parsed.tag !== 'string' ||
      !('ciphertext' in parsed) ||
      typeof parsed.ciphertext !== 'string'
    )
      throw new Error();
    const nonce = Buffer.from(parsed.nonce, 'base64url');
    const tag = Buffer.from(parsed.tag, 'base64url');

    if (nonce.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);

    decipher.setAAD(aad);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(Buffer.from(parsed.ciphertext, 'base64url')), decipher.final()]);
  } catch {
    throw new Error('Canary authentication failed.');
  }
}

export type KeyProof = { authenticatedDecryption: true; missingKeyRejected: true; wrongKeyRejected: true };

export function proveKeyBoundary(
  decrypt: (key?: Uint8Array) => Buffer,
  key: Uint8Array,
  expected: Uint8Array,
): KeyProof {
  const plaintext = decrypt(key);

  try {
    if (plaintext.length !== expected.length || !timingSafeEqual(plaintext, expected))
      throw new Error('Restored fixture plaintext differs.');
  } finally {
    plaintext.fill(0);
  }
  const wrongKey = Buffer.from(key);

  wrongKey[0] ^= 1;
  try {
    for (const candidate of [undefined, wrongKey]) {
      let rejected = false;

      try {
        decrypt(candidate).fill(0);
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('Fixture decryption accepted an unavailable or incorrect key.');
    }
  } finally {
    wrongKey.fill(0);
  }

  return { authenticatedDecryption: true, missingKeyRejected: true, wrongKeyRejected: true };
}

// Mirrors the product's documented TOTP v1 format and KDF without importing an
// auth runtime or reading ambient application secrets. This is a synthetic record.
function totpKey(secret: Uint8Array): Buffer {
  return scryptSync(Buffer.from(secret).toString('base64url'), 'themis-totp-secret-v1', 32);
}

export function encryptTotpFixture(plaintext: Uint8Array, secret: Uint8Array): string {
  const key = totpKey(secret);

  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    return [
      '1',
      nonce.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  } finally {
    key.fill(0);
  }
}

export function decryptTotpFixture(value: string, secret?: Uint8Array): Buffer {
  if (!secret || secret.byteLength !== 32) throw new Error('TOTP fixture key is unavailable.');
  const key = totpKey(secret);

  try {
    const [version, nonce, tag, ciphertext, extra] = value.split('.');

    if (version !== '1' || !nonce || !tag || !ciphertext || extra !== undefined) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
    const authTag = Buffer.from(tag, 'base64url');

    if (authTag.length !== 16) throw new Error();
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
  } catch {
    throw new Error('TOTP fixture authentication failed.');
  } finally {
    key.fill(0);
  }
}

export type TotpFixture = { encryptedSecret: string; verify: (restored: string) => KeyProof; cleanup: () => void };

export function createProtectedTotpFixture(directory: string): TotpFixture {
  const privateDirectory = mkdtempSync(join(directory, 'totp-key-'));
  const path = join(privateDirectory, 'server-key');
  const secret = randomBytes(32);
  const plaintext = Buffer.from(
    [...randomBytes(32)].map((byte) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[byte & 31]).join(''),
  );

  try {
    chmodSync(privateDirectory, 0o700);
    writeFileSync(path, secret, { mode: 0o600, flag: 'wx' });
    const encryptedSecret = encryptTotpFixture(plaintext, secret);

    return {
      encryptedSecret,
      verify(restored) {
        if (restored !== encryptedSecret) throw new Error('Restored TOTP fixture ciphertext differs.');
        const recoveredKey = readFileSync(path);

        try {
          return proveKeyBoundary((key) => decryptTotpFixture(restored, key), recoveredKey, plaintext);
        } finally {
          recoveredKey.fill(0);
        }
      },
      cleanup() {
        plaintext.fill(0);
        rmSync(privateDirectory, { recursive: true, force: true });
      },
    };
  } catch {
    plaintext.fill(0);
    rmSync(privateDirectory, { recursive: true, force: true });
    throw new Error('Protected TOTP fixture could not be created.');
  } finally {
    secret.fill(0);
  }
}
