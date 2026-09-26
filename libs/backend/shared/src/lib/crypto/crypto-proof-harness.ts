import { createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;

export const CRYPTO_PROOF_VERSION = 1;

export type AeadCiphertext = {
  ciphertext: string;
  authTag: string;
};

export type WrappedKey = AeadCiphertext & { nonce: string };

export function assertCryptoProofVersion(version: number): void {
  if (version !== CRYPTO_PROOF_VERSION) {
    throw new Error(`Unsupported cryptographic proof version: ${version}.`);
  }
}

function bytes(value: Uint8Array, label: string, expectedLength?: number): Buffer {
  const result = Buffer.from(value);

  if (expectedLength !== undefined && result.length !== expectedLength) {
    throw new TypeError(`${label} must be ${expectedLength} bytes.`);
  }

  return result;
}

function aadBytes(associatedData: string): Buffer {
  return Buffer.from(associatedData, 'utf8');
}

/**
 * ZK-004 proof choice: HKDF-SHA-256 derives a workspace key from a 256-bit
 * VMK. The VMK itself is intentionally supplied by a future vault, not
 * derived from a password by this proof harness.
 */
export function deriveWorkspaceKey(vmk: Uint8Array, workspaceId: string, salt: Uint8Array): Buffer {
  const root = bytes(vmk, 'VMK', KEY_BYTES);
  const info = Buffer.from(`themis/workspace-key/v1/${workspaceId}`, 'utf8');

  return Buffer.from(hkdfSync('sha256', root, bytes(salt, 'HKDF salt'), info, KEY_BYTES));
}

/** Deterministic AES-256-GCM operation used only for proof vectors. */
export function encryptAead(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  associatedData: string,
): AeadCiphertext {
  const cipher = createCipheriv(
    'aes-256-gcm',
    bytes(key, 'AEAD key', KEY_BYTES),
    bytes(nonce, 'AEAD nonce', NONCE_BYTES),
  );

  cipher.setAAD(aadBytes(associatedData));

  return {
    ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

export function decryptAead(
  key: Uint8Array,
  nonce: Uint8Array,
  encrypted: AeadCiphertext,
  associatedData: string,
): Buffer {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    bytes(key, 'AEAD key', KEY_BYTES),
    bytes(nonce, 'AEAD nonce', NONCE_BYTES),
  );

  decipher.setAAD(aadBytes(associatedData));

  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));

  return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'hex')), decipher.final()]);
}

/** Wraps a workspace key under the VMK with domain-separated associated data. */
export function wrapWorkspaceKey(
  vmk: Uint8Array,
  workspaceKey: Uint8Array,
  nonce: Uint8Array,
  workspaceId: string,
): WrappedKey {
  return {
    nonce: Buffer.from(nonce).toString('hex'),
    ...encryptAead(vmk, nonce, workspaceKey, `themis/workspace-key-wrap/v1/${workspaceId}`),
  };
}

export function unwrapWorkspaceKey(vmk: Uint8Array, wrapped: WrappedKey, workspaceId: string): Buffer {
  return decryptAead(vmk, Buffer.from(wrapped.nonce, 'hex'), wrapped, `themis/workspace-key-wrap/v1/${workspaceId}`);
}

/** The caller, rather than AES-GCM, owns nonce uniqueness. */
export class NonceReuseGuard {
  private readonly seen = new Set<string>();

  accept(key: Uint8Array, nonce: Uint8Array): void {
    const keyBytes = bytes(key, 'AEAD key', KEY_BYTES);
    const nonceBytes = bytes(nonce, 'AEAD nonce', NONCE_BYTES);
    const identity = `${keyBytes.toString('hex')}:${nonceBytes.toString('hex')}`;

    if (this.seen.has(identity)) {
      throw new Error('AEAD nonce was already used with this key.');
    }

    this.seen.add(identity);
  }
}
