import { createCipheriv, hkdfSync, webcrypto } from 'node:crypto';

import { prfKeyEnvelope } from './vault-key-contract';
import type { PrfKeyBinding, PrfKeyEnvelope, VaultKeyEnvelopeMetadata } from './vault-key-contract';
import {
  decodeRecoveryBytes,
  decodeVaultBytes,
  derivePrfWrappingKey,
  encodeRecoveryBytes,
  encodeVaultBytes,
  openVaultKey,
  sealVaultKey,
  vaultKeyBindingBytes,
} from './vault-key-envelope';

const crypto = webcrypto as unknown as Crypto;
const binding: PrfKeyBinding = {
  ownerUserId: '11111111-1111-4111-8111-111111111111',
  personalScopeId: '22222222-2222-4222-8222-222222222222',
  methodId: '33333333-3333-4333-8333-333333333333',
  methodKind: 'passkey-prf',
  credentialId: 'AQ',
  keyGeneration: 1,
};
// Synthetic deterministic bytes, never real vault or credential material.
const dek = new Uint8Array(32).fill(7);
const prf = new Uint8Array(32).fill(9);
const salt = encodeVaultBytes(new Uint8Array(32).fill(3));
const metadata: VaultKeyEnvelopeMetadata = {
  version: 1,
  binding,
  hkdfSalt: salt,
  prfInput: encodeVaultBytes(new Uint8Array(32).fill(4)),
  kdfProfile: 'prf-hkdf-sha256-v1',
};

test('matches independently encoded HKDF/AES-GCM bytes, not only its own round-trip', async () => {
  const canonical =
    '["visomi-vault-key-envelope-v1","11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333","passkey-prf","AQ",1]';
  const keyBytes = hkdfSync('sha256', prf, new Uint8Array(32).fill(3), Buffer.from(canonical), 32);
  const iv = new Uint8Array(12).fill(5);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBytes), iv);

  cipher.setAAD(Buffer.from(canonical));
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final(), cipher.getAuthTag()]);
  const envelope = { ...metadata, iv: encodeVaultBytes(iv), ciphertext: ciphertext.toString('base64url') };
  const key = await derivePrfWrappingKey(crypto, prf, binding, salt);
  const result = await openVaultKey(crypto, key, envelope, binding);

  expect(new TextDecoder().decode(vaultKeyBindingBytes(binding))).toBe(canonical);
  expect(result).toEqual(dek);
  expect(key.extractable).toBe(false);
  await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  result.fill(0);
});

test('uses fresh IVs without mutating caller-owned key bytes', async () => {
  const key = await derivePrfWrappingKey(crypto, prf, binding, salt);
  const first = await sealVaultKey(crypto, key, dek, metadata);
  const second = await sealVaultKey(crypto, key, dek, metadata);
  const result = await openVaultKey(crypto, key, first, binding);

  expect(first.iv).not.toBe(second.iv);
  expect(result).toEqual(dek);
  expect(dek).toEqual(new Uint8Array(32).fill(7));
  expect(prf).toEqual(new Uint8Array(32).fill(9));
  result.fill(0);
});

test.each(['ownerUserId', 'personalScopeId', 'methodId', 'credentialId'] as const)(
  'rejects substituted %s both before open and when deriving another wrapping key',
  async (field) => {
    const key = await derivePrfWrappingKey(crypto, prf, binding, salt);
    const envelope = await sealVaultKey(crypto, key, dek, metadata);
    const parsed = prfKeyEnvelope.parse(envelope);
    const changed = { ...binding, [field]: field === 'credentialId' ? 'Ag' : '55555555-5555-4555-8555-555555555555' };
    const differentKey = await derivePrfWrappingKey(crypto, prf, changed, salt);

    await expect(openVaultKey(crypto, key, envelope, changed)).rejects.toThrow('vault_key_binding_mismatch');
    await expect(openVaultKey(crypto, differentKey, { ...parsed, binding: changed }, changed)).rejects.toThrow();
  },
);

test('rejects tampering, incorrect PRF/salt and unsupported metadata', async () => {
  const key = await derivePrfWrappingKey(crypto, prf, binding, salt);
  const envelope = await sealVaultKey(crypto, key, dek, metadata);
  const bytes = decodeVaultBytes(envelope.ciphertext, 48);

  for (const index of [0, 31, 47]) {
    const changed = new Uint8Array(bytes);

    changed[index] ^= 1;
    await expect(
      openVaultKey(crypto, key, { ...envelope, ciphertext: encodeVaultBytes(changed) }, binding),
    ).rejects.toThrow();
  }

  const iv = decodeVaultBytes(envelope.iv, 12);

  iv[0] ^= 1;
  await expect(openVaultKey(crypto, key, { ...envelope, iv: encodeVaultBytes(iv) }, binding)).rejects.toThrow();
  const wrongPrf = await derivePrfWrappingKey(crypto, new Uint8Array(32), binding, salt);
  const wrongSalt = await derivePrfWrappingKey(crypto, prf, binding, encodeVaultBytes(new Uint8Array(32)));

  await expect(openVaultKey(crypto, wrongPrf, envelope, binding)).rejects.toThrow();
  await expect(openVaultKey(crypto, wrongSalt, envelope, binding)).rejects.toThrow();
  await expect(
    openVaultKey(crypto, key, { ...envelope, version: 2 } as unknown as PrfKeyEnvelope, binding),
  ).rejects.toThrow();
  await expect(derivePrfWrappingKey(crypto, new Uint8Array(31), binding, salt)).rejects.toThrow('invalid_prf_output');
});

test('requires canonical recovery encodings and the template protocol version', () => {
  const recovery = encodeRecoveryBytes(dek);

  expect(decodeRecoveryBytes(recovery)).toEqual(dek);
  expect(() => decodeRecoveryBytes('stack1.' + 'A'.repeat(42) + 'B')).toThrow();
  expect(() => decodeRecoveryBytes('nive1.' + recovery.slice(7))).toThrow();
  expect(() => encodeRecoveryBytes(new Uint8Array(31))).toThrow();
  expect(() => decodeVaultBytes('A'.repeat(43) + '=', 32)).toThrow();
});

test('supports local PIN envelopes without accepting a PRF/browser binding substitution', async () => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const pinMetadata: VaultKeyEnvelopeMetadata = {
    version: 1,
    binding: {
      ownerUserId: binding.ownerUserId,
      personalScopeId: binding.personalScopeId,
      methodId: binding.methodId,
      methodKind: 'local-pin',
      browserId: '44444444-4444-4444-8444-444444444444',
      keyGeneration: 1,
    },
    hkdfSalt: salt,
    argon2Salt: encodeVaultBytes(new Uint8Array(16)),
    kdfProfile: 'pin-argon2id-hkdf-sha256-v1',
  };
  const envelope = await sealVaultKey(crypto, key, dek, pinMetadata);
  const result = await openVaultKey(crypto, key, envelope, pinMetadata.binding);

  expect(result).toEqual(dek);
  result.fill(0);
  await expect(openVaultKey(crypto, key, envelope, binding)).rejects.toThrow('vault_key_binding_mismatch');
  await expect(
    openVaultKey(crypto, key, envelope, {
      ...pinMetadata.binding,
      browserId: binding.methodId,
    }),
  ).rejects.toThrow('vault_key_binding_mismatch');
});

test('rejects extractable wrapping keys and injected envelope fields', async () => {
  const extractable = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

  await expect(sealVaultKey(crypto, extractable, dek, metadata)).rejects.toThrow('invalid_vault_crypto_key');
  expect(
    prfKeyEnvelope.safeParse({ ...metadata, iv: 'A'.repeat(16), ciphertext: 'A'.repeat(64), plaintext: 'secret' })
      .success,
  ).toBe(false);
});
