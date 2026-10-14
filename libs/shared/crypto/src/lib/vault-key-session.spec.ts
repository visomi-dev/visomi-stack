import { webcrypto } from 'node:crypto';

import type { PrfKeyEnvelope } from './vault-key-contract';
import { derivePrfWrappingKey, encodeRecoveryBytes, encodeVaultBytes, openVaultKey } from './vault-key-envelope';
import { VaultKeySession } from './vault-key-session';
import { browserVaultFingerprint, createBrowserVaultPairing, openBrowserVaultKey } from './vault-browser-enrollment';

const crypto = webcrypto as unknown as Crypto;
const raw = new Uint8Array(32).fill(7);
const metadata: Omit<PrfKeyEnvelope, 'iv' | 'ciphertext'> = {
  version: 1,
  binding: {
    ownerUserId: '11111111-1111-4111-8111-111111111111',
    personalScopeId: '22222222-2222-4222-8222-222222222222',
    methodId: '33333333-3333-4333-8333-333333333333',
    methodKind: 'passkey-prf',
    credentialId: 'AQ',
    keyGeneration: 1,
  },
  hkdfSalt: encodeVaultBytes(new Uint8Array(32).fill(3)),
  prfInput: encodeVaultBytes(new Uint8Array(32).fill(4)),
  kdfProfile: 'prf-hkdf-sha256-v1',
};

test('relays capsule-held bytes only to the bound browser and invalidates delivery on lock', async () => {
  const session = new VaultKeySession(crypto);
  const recipient = await createBrowserVaultPairing(
    crypto,
    metadata.binding.ownerUserId,
    metadata.binding.personalScopeId,
    '2026-10-04T12:00:00.000Z',
  );
  const binding = {
    ownerUserId: recipient.pairing.ownerUserId,
    personalScopeId: recipient.pairing.personalScopeId,
    requestId: recipient.pairing.requestId,
    challenge: recipient.pairing.challenge,
    fingerprint: await browserVaultFingerprint(crypto, recipient.pairing),
    recipientEncryption: recipient.pairing.keys.encryption,
    keyGeneration: 1 as const,
  };

  await session.unlock(raw);
  const envelope = await session.deliverToBrowser(binding);
  const bytes = await openBrowserVaultKey(crypto, recipient.identity.encryption.privateKey, binding, envelope);

  expect(bytes).toEqual(raw);
  expect(session.borrowDataKey().extractable).toBe(false);
  bytes.fill(0);
  const pending = session.deliverToBrowser(binding);

  session.lock();
  await expect(pending).rejects.toThrow('vault_locked');
  await expect(session.deliverToBrowser(binding)).rejects.toThrow('vault_locked');
});

test('keeps a non-extractable data key and rewraps internally', async () => {
  const session = new VaultKeySession(crypto);

  await session.unlock(raw);
  const key = session.borrowDataKey();
  const kek = await derivePrfWrappingKey(crypto, new Uint8Array(32).fill(9), metadata.binding, metadata.hkdfSalt);
  const envelope = await session.wrapVaultKey(kek, metadata);
  const bytes = await openVaultKey(crypto, kek, envelope, metadata.binding);
  const recovery = await session.exportRecovery();

  expect(bytes).toEqual(raw);
  expect(recovery).toBe(encodeRecoveryBytes(raw));
  expect(key.extractable).toBe(false);
  await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  bytes.fill(0);
  session.lock();
  expect(() => session.borrowDataKey()).toThrow('vault_locked');
  await expect(session.exportRecovery()).rejects.toThrow('vault_locked');
  await expect(session.wrapVaultKey(kek, metadata)).rejects.toThrow('vault_locked');
});

test('lock during key import or capsule open cannot publish key material', async () => {
  const session = new VaultKeySession(crypto);
  const unlocking = session.unlock(raw);

  session.lock();
  await expect(unlocking).rejects.toThrow('vault_locked');
  expect(() => session.borrowDataKey()).toThrow('vault_locked');
  await session.unlock(raw);
  const exporting = session.exportRecovery();

  session.lock();
  await expect(exporting).rejects.toThrow('vault_locked');
});

test('replacement invalidates older operations and invalid keys discard previous access', async () => {
  const session = new VaultKeySession(crypto);

  await session.unlock(raw);
  const pending = session.exportRecovery();
  const invalidated = expect(pending).rejects.toThrow('vault_locked');

  await session.unlock(new Uint8Array(32).fill(8));
  await invalidated;
  const recovery = await session.exportRecovery();

  expect(recovery).toBe(encodeRecoveryBytes(new Uint8Array(32).fill(8)));
  await expect(session.unlock(new Uint8Array(31))).rejects.toThrow('invalid_vault_key');
  expect(() => session.borrowDataKey()).toThrow('vault_locked');
});

test('lock during rewrapping cannot return a completed envelope', async () => {
  const session = new VaultKeySession(crypto);
  const kek = await derivePrfWrappingKey(crypto, new Uint8Array(32), metadata.binding, metadata.hkdfSalt);

  await session.unlock(raw);
  let markEntered: () => void = () => undefined;
  let release: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  const spy = jest.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => {
    const output = await encrypt(...args);

    markEntered();
    await gate;

    return output;
  });

  try {
    const pending = session.wrapVaultKey(kek, metadata);
    const rejected = expect(pending).rejects.toThrow('vault_locked');

    await entered;
    session.lock();
    release();
    await rejected;
  } finally {
    release();
    spy.mockRestore();
  }
});
