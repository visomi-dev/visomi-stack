import { vaultKeyBinding, vaultKeyEnvelope } from './vault-key-contract';
import type { PrfKeyBinding, VaultKeyBinding, VaultKeyEnvelope, VaultKeyEnvelopeMetadata } from './vault-key-contract';

export function encodeVaultBytes(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeVaultBytes(value: string, length: number): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length !== Math.ceil((length * 8) / 6)) {
    throw new Error('invalid_vault_encoding');
  }

  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (character) =>
    character.charCodeAt(0),
  );

  if (bytes.length !== length || encodeVaultBytes(bytes) !== value) {
    throw new Error('invalid_vault_encoding');
  }

  return bytes;
}

export function decodeRecoveryBytes(recovery: string): Uint8Array<ArrayBuffer> {
  if (!recovery.startsWith('stack1.')) {
    throw new Error('invalid_recovery_key');
  }

  return decodeVaultBytes(recovery.slice(7), 32);
}

export function encodeRecoveryBytes(bytes: Uint8Array): string {
  if (bytes.length !== 32) {
    throw new Error('invalid_vault_key');
  }

  return `stack1.${encodeVaultBytes(bytes)}`;
}

export function vaultKeyBindingBytes(input: VaultKeyBinding): Uint8Array<ArrayBuffer> {
  const binding = vaultKeyBinding.parse(input);
  const identifier = binding.methodKind === 'passkey-prf' ? binding.credentialId : binding.browserId;

  return new TextEncoder().encode(
    JSON.stringify([
      'visomi-vault-key-envelope-v1',
      binding.ownerUserId,
      binding.personalScopeId,
      binding.methodId,
      binding.methodKind,
      identifier,
      binding.keyGeneration,
    ]),
  );
}

export async function derivePrfWrappingKey(
  crypto: Crypto,
  prfOutput: Uint8Array,
  binding: PrfKeyBinding,
  hkdfSalt: string,
): Promise<CryptoKey> {
  if (prfOutput.length !== 32 || binding.methodKind !== 'passkey-prf') {
    throw new Error('invalid_prf_output');
  }

  const info = vaultKeyBindingBytes(binding);
  const salt = decodeVaultBytes(hkdfSalt, 32);
  const bytes = new Uint8Array(prfOutput);

  try {
    const inputKey = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info },
      inputKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );

    return key;
  } finally {
    bytes.fill(0);
  }
}

export function assertVaultCryptoKey(key: CryptoKey): void {
  const algorithm = key.algorithm as KeyAlgorithm & { length?: number };

  if (
    key.type !== 'secret' ||
    key.extractable ||
    algorithm.name !== 'AES-GCM' ||
    algorithm.length !== 256 ||
    !key.usages.includes('encrypt') ||
    !key.usages.includes('decrypt')
  ) {
    throw new Error('invalid_vault_crypto_key');
  }
}

export async function sealVaultKey(
  crypto: Crypto,
  wrappingKey: CryptoKey,
  dek: Uint8Array,
  metadata: VaultKeyEnvelopeMetadata,
): Promise<VaultKeyEnvelope> {
  assertVaultCryptoKey(wrappingKey);

  if (dek.length !== 32) {
    throw new Error('invalid_vault_key');
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const envelope = vaultKeyEnvelope.parse({ ...metadata, iv: encodeVaultBytes(iv), ciphertext: 'A'.repeat(64) });
  const bytes = new Uint8Array(dek);

  try {
    const result = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: vaultKeyBindingBytes(envelope.binding), tagLength: 128 },
      wrappingKey,
      bytes,
    );

    return vaultKeyEnvelope.parse({ ...envelope, ciphertext: encodeVaultBytes(new Uint8Array(result)) });
  } finally {
    bytes.fill(0);
  }
}

/** Transient key bytes for session import. The caller must clear them in finally. */
export async function openVaultKey(
  crypto: Crypto,
  wrappingKey: CryptoKey,
  input: VaultKeyEnvelope,
  expectedBinding: VaultKeyBinding,
): Promise<Uint8Array<ArrayBuffer>> {
  const envelope = vaultKeyEnvelope.parse(input);
  const aad = vaultKeyBindingBytes(expectedBinding);

  if (encodeVaultBytes(aad) !== encodeVaultBytes(vaultKeyBindingBytes(envelope.binding))) {
    throw new Error('vault_key_binding_mismatch');
  }

  assertVaultCryptoKey(wrappingKey);
  const result = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeVaultBytes(envelope.iv, 12), additionalData: aad, tagLength: 128 },
    wrappingKey,
    decodeVaultBytes(envelope.ciphertext, 48),
  );
  const bytes = new Uint8Array(result);

  if (bytes.length !== 32) {
    bytes.fill(0);

    throw new Error('invalid_vault_key');
  }

  return bytes;
}
