import { deviceKeyBinding, deviceKeyEnvelope, devicePairing, devicePairingInput } from './device-key-contract';
import type { DeviceKeyBinding, DeviceKeyEnvelope, DevicePairing } from './device-key-contract';
import { decodeRecoveryBytes, decodeVaultBytes, encodeVaultBytes } from './vault-key-envelope';

export type DeviceIdentity = { signing: CryptoKeyPair; encryption: CryptoKeyPair };

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return decodeVaultBytes(value, Math.floor((value.length * 6) / 8));
}

function pairingMessage(input: Omit<DevicePairing, 'proof'>): Uint8Array<ArrayBuffer> {
  const pairing = devicePairingInput.parse(input);

  return new TextEncoder().encode(
    JSON.stringify([
      'visomi-device-pairing-v1',
      pairing.clientId,
      pairing.challenge,
      pairing.expiresAt,
      pairing.keys.signing,
      pairing.keys.encryption,
    ]),
  );
}

function keyLabel(input: DeviceKeyBinding): Uint8Array<ArrayBuffer> {
  const binding = deviceKeyBinding.parse(input);

  return new TextEncoder().encode(
    JSON.stringify([
      'visomi-device-key-v1',
      binding.ownerUserId,
      binding.workspaceId,
      binding.clientId,
      binding.challenge,
      binding.keyGeneration,
    ]),
  );
}

function assertEncryptionKey(key: CryptoKey): void {
  const algorithm = key.algorithm as Partial<RsaHashedKeyAlgorithm>;

  if (algorithm.name !== 'RSA-OAEP' || algorithm.modulusLength !== 3072 || algorithm.hash?.name !== 'SHA-256') {
    throw new Error('invalid_device_encryption_key');
  }
}

async function importEncryptionKey(crypto: Crypto, encryption: string): Promise<CryptoKey> {
  devicePairingInput.shape.keys.shape.encryption.parse(encryption);
  const key = await crypto.subtle.importKey('spki', bytes(encryption), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'encrypt',
  ]);

  assertEncryptionKey(key);

  return key;
}

/** Private keys are non-extractable; callers own persistence and revocation. */
export async function createDeviceIdentity(crypto: Crypto): Promise<DeviceIdentity> {
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const encryption = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    false,
    ['encrypt', 'decrypt'],
  );

  return { signing, encryption };
}

export async function createDevicePairing(
  crypto: Crypto,
  identity: DeviceIdentity,
  expiresAt: string,
): Promise<DevicePairing> {
  assertEncryptionKey(identity.encryption.publicKey);
  const signing = await crypto.subtle.exportKey('spki', identity.signing.publicKey);
  const encryption = await crypto.subtle.exportKey('spki', identity.encryption.publicKey);
  const pairing = devicePairingInput.parse({
    version: 1,
    clientId: crypto.randomUUID(),
    expiresAt,
    challenge: encodeVaultBytes(crypto.getRandomValues(new Uint8Array(32))),
    keys: {
      signing: encodeVaultBytes(new Uint8Array(signing)),
      encryption: encodeVaultBytes(new Uint8Array(encryption)),
    },
  });
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.signing.privateKey,
    pairingMessage(pairing),
  );

  return devicePairing.parse({ ...pairing, proof: encodeVaultBytes(new Uint8Array(signature)) });
}

/** Proof authenticates keys, not user authority, expiry or one-time challenge consumption. */
export async function verifyDevicePairing(crypto: Crypto, input: DevicePairing): Promise<boolean> {
  const parsed = devicePairing.safeParse(input);

  if (!parsed.success) return false;
  const pairing = parsed.data;
  const { proof, ...unsigned } = pairing;

  try {
    await importEncryptionKey(crypto, pairing.keys.encryption);
    const key = await crypto.subtle.importKey(
      'spki',
      bytes(pairing.keys.signing),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      bytes(proof),
      pairingMessage(unsigned),
    );

    return valid;
  } catch {
    return false;
  }
}

export async function deviceFingerprint(crypto: Crypto, input: DevicePairing): Promise<string> {
  const pairing = devicePairing.parse(input);
  const { proof: _proof, ...unsigned } = pairing;
  const digest = await crypto.subtle.digest('SHA-256', pairingMessage(unsigned));

  return encodeVaultBytes(new Uint8Array(digest));
}

export async function sealDeviceRecovery(
  crypto: Crypto,
  encryption: string,
  binding: DeviceKeyBinding,
  recovery: string,
): Promise<DeviceKeyEnvelope> {
  const secret = decodeRecoveryBytes(recovery);

  secret.fill(0);
  const key = await importEncryptionKey(crypto, encryption);
  const plaintext = new TextEncoder().encode(recovery);

  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'RSA-OAEP', label: keyLabel(binding) }, key, plaintext);

    return deviceKeyEnvelope.parse({ version: 1, ciphertext: encodeVaultBytes(new Uint8Array(ciphertext)) });
  } finally {
    plaintext.fill(0);
  }
}

export async function openDeviceRecovery(
  crypto: Crypto,
  key: CryptoKey,
  binding: DeviceKeyBinding,
  input: DeviceKeyEnvelope,
): Promise<string> {
  assertEncryptionKey(key);
  const envelope = deviceKeyEnvelope.parse(input);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP', label: keyLabel(binding) },
    key,
    bytes(envelope.ciphertext),
  );
  const secret = new Uint8Array(plaintext);

  try {
    const recovery = new TextDecoder('utf-8', { fatal: true }).decode(secret);
    const decoded = decodeRecoveryBytes(recovery);

    decoded.fill(0);

    return recovery;
  } finally {
    secret.fill(0);
  }
}
