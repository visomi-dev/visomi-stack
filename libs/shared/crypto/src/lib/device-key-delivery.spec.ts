import { webcrypto } from 'node:crypto';

import { deviceKeyBinding, deviceKeyEnvelope, devicePairing } from './device-key-contract';
import {
  createDeviceIdentity,
  createDevicePairing,
  deviceFingerprint,
  openDeviceRecovery,
  sealDeviceRecovery,
  verifyDevicePairing,
} from './device-key-delivery';
import type { DeviceIdentity } from './device-key-delivery';
import { encodeRecoveryBytes, encodeVaultBytes } from './vault-key-envelope';

const crypto = webcrypto as unknown as Crypto;
let identity: DeviceIdentity;
let other: DeviceIdentity;

beforeAll(async () => {
  identity = await createDeviceIdentity(crypto);
  other = await createDeviceIdentity(crypto);
}, 30000);

async function fixture() {
  const pairing = await createDevicePairing(crypto, identity, '2026-10-03T12:00:00Z');
  const binding = {
    ownerUserId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    clientId: pairing.clientId,
    challenge: pairing.challenge,
    keyGeneration: 1,
  };
  const recovery = encodeRecoveryBytes(crypto.getRandomValues(new Uint8Array(32)));

  return { pairing, binding, recovery };
}

describe('portable device key delivery', () => {
  it('keeps private keys non-extractable while allowing public pairing serialization', async () => {
    expect(identity.signing.privateKey.extractable).toBe(false);
    expect(identity.encryption.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', identity.signing.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('pkcs8', identity.encryption.privateKey)).rejects.toThrow();
    const { pairing } = await fixture();
    const valid = await verifyDevicePairing(crypto, pairing);

    expect(valid).toBe(true);
  });

  it('binds proof and fingerprint to both public keys, client, challenge and expiration', async () => {
    const { pairing } = await fixture();
    const replacement = await createDevicePairing(crypto, other, pairing.expiresAt);
    const fingerprint = await deviceFingerprint(crypto, pairing);

    for (const change of [
      { clientId: crypto.randomUUID() },
      { challenge: replacement.challenge },
      { expiresAt: '2026-10-03T12:01:00Z' },
      { keys: { ...pairing.keys, signing: replacement.keys.signing } },
      { keys: { ...pairing.keys, encryption: replacement.keys.encryption } },
    ]) {
      const modified = { ...pairing, ...change };
      const valid = await verifyDevicePairing(crypto, modified);
      const changedFingerprint = await deviceFingerprint(crypto, modified);

      expect(valid).toBe(false);
      expect(changedFingerprint).not.toBe(fingerprint);
    }
  });

  it('delivers only to the intended private key and full owner/workspace/recipient/generation binding', async () => {
    const { pairing, binding, recovery } = await fixture();
    const envelope = await sealDeviceRecovery(crypto, pairing.keys.encryption, binding, recovery);
    const opened = await openDeviceRecovery(crypto, identity.encryption.privateKey, binding, envelope);

    expect(opened).toBe(recovery);
    expect(JSON.stringify(envelope)).not.toContain(recovery);
    await expect(openDeviceRecovery(crypto, other.encryption.privateKey, binding, envelope)).rejects.toThrow();
    for (const field of ['ownerUserId', 'workspaceId', 'clientId'] as const) {
      await expect(
        openDeviceRecovery(
          crypto,
          identity.encryption.privateKey,
          { ...binding, [field]: crypto.randomUUID() },
          envelope,
        ),
      ).rejects.toThrow();
    }
    await expect(
      openDeviceRecovery(
        crypto,
        identity.encryption.privateKey,
        { ...binding, challenge: encodeVaultBytes(new Uint8Array(32)) },
        envelope,
      ),
    ).rejects.toThrow();
    await expect(
      openDeviceRecovery(crypto, identity.encryption.privateKey, { ...binding, keyGeneration: 2 }, envelope),
    ).rejects.toThrow();
  });

  it('rejects unknown fields, padded/non-canonical encodings, malformed bindings and unsupported versions', async () => {
    const { pairing, binding, recovery } = await fixture();

    expect(devicePairing.safeParse({ ...pairing, extra: true }).success).toBe(false);
    expect(devicePairing.safeParse({ ...pairing, challenge: `${pairing.challenge}=` }).success).toBe(false);
    expect(devicePairing.safeParse({ ...pairing, challenge: `${'A'.repeat(42)}B` }).success).toBe(false);
    expect(deviceKeyBinding.safeParse({ ...binding, keyGeneration: 0 }).success).toBe(false);
    expect(deviceKeyBinding.safeParse({ ...binding, ownerUserId: 'owner' }).success).toBe(false);
    expect(deviceKeyEnvelope.safeParse({ version: 2, ciphertext: 'A'.repeat(512) }).success).toBe(false);
    await expect(
      sealDeviceRecovery(crypto, pairing.keys.encryption, binding, recovery.replace('stack1.', 'nive1.')),
    ).rejects.toThrow();
    const malformed = { ...pairing, keys: { ...pairing.keys, signing: 'A'.repeat(128) } };
    const valid = await verifyDevicePairing(crypto, malformed);

    expect(valid).toBe(false);
  });

  it('rejects weak RSA keys and corrupted ciphertext', async () => {
    const { pairing, binding, recovery } = await fixture();
    const weak = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['encrypt', 'decrypt'],
    );
    const publicKey = await crypto.subtle.exportKey('spki', weak.publicKey);

    await expect(
      sealDeviceRecovery(crypto, encodeVaultBytes(new Uint8Array(publicKey)), binding, recovery),
    ).rejects.toThrow();
    const envelope = await sealDeviceRecovery(crypto, pairing.keys.encryption, binding, recovery);
    const ciphertext = `${envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.slice(1)}`;

    await expect(
      openDeviceRecovery(crypto, identity.encryption.privateKey, binding, { ...envelope, ciphertext }),
    ).rejects.toThrow();
  });
});
