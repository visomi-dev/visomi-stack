import { webcrypto } from 'node:crypto';

import type { LocalPinEnvelope } from './vault-key-contract';
import { encodeVaultBytes, openVaultKey, sealVaultKey } from './vault-key-envelope';
import { derivePinWrappingKey, isVaultPinValid } from './vault-pin-key';

const crypto = webcrypto as unknown as Crypto;
const metadata: Omit<LocalPinEnvelope, 'iv' | 'ciphertext'> = {
  version: 1,
  kdfProfile: 'pin-argon2id-hkdf-sha256-v1',
  binding: {
    ownerUserId: '11111111-1111-4111-8111-111111111111',
    personalScopeId: '22222222-2222-4222-8222-222222222222',
    methodId: '33333333-3333-4333-8333-333333333333',
    browserId: '44444444-4444-4444-8444-444444444444',
    keyGeneration: 1,
    methodKind: 'local-pin',
  },
  argon2Salt: encodeVaultBytes(new Uint8Array(16).fill(3)),
  hkdfSalt: encodeVaultBytes(new Uint8Array(32).fill(4)),
};

test.each(['12345', '1234567', '１２３４５６', ' 294716', '29471 ', 'aaaaaa', '000000', '123456', '789012', '109876'])(
  'rejects malformed and predictable six-digit PIN %s',
  (pin) => {
    expect(isVaultPinValid(pin)).toBe(false);
  },
);

test('keeps leading zeros and derives reproducible non-extractable wrapping keys', async () => {
  expect(isVaultPinValid('029471')).toBe(true);
  const first = await derivePinWrappingKey(crypto, '029471', metadata);
  const second = await derivePinWrappingKey(crypto, '029471', metadata);
  const wrong = await derivePinWrappingKey(crypto, '029472', metadata);
  const dek = new Uint8Array(32).fill(7);
  const envelope = await sealVaultKey(crypto, first, dek, metadata);
  const opened = await openVaultKey(crypto, second, envelope, metadata.binding);

  expect(opened).toEqual(dek);
  expect(first.extractable).toBe(false);
  opened.fill(0);
  await expect(openVaultKey(crypto, wrong, envelope, metadata.binding)).rejects.toThrow();
});

test('rejects unknown profiles and injected KDF parameters before running Argon2id', async () => {
  await expect(
    derivePinWrappingKey(crypto, '029471', {
      ...metadata,
      kdfProfile: 'fast-hash',
    } as unknown as typeof metadata),
  ).rejects.toThrow();
  await expect(
    derivePinWrappingKey(crypto, '029471', {
      ...metadata,
      memorySize: 1_000_000_000,
    } as unknown as typeof metadata),
  ).rejects.toThrow();
});
