import { createDeviceIdentity } from './device-key-delivery';
import type { DeviceIdentity } from './device-key-delivery';
import { decodeVaultBytes, encodeVaultBytes } from './vault-key-envelope';
import {
  browserVaultBinding,
  browserVaultConsume,
  browserVaultPairing,
  browserVaultDelivery,
} from './vault-browser-contract';
import type { BrowserVaultBinding, BrowserVaultConsume, BrowserVaultPairing } from './vault-browser-contract';
import type { DeviceKeyEnvelope } from './device-key-contract';

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return decodeVaultBytes(value, Math.floor((value.length * 6) / 8));
}

function pairingBytes(input: Omit<BrowserVaultPairing, 'proof'>): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify([
      'visomi-vault-browser-pairing-v1',
      input.requestId,
      input.ownerUserId,
      input.personalScopeId,
      input.challenge,
      input.expiresAt,
      input.keys.signing,
      input.keys.encryption,
    ]),
  );
}

function consumeBytes(
  pairing: BrowserVaultPairing,
  input: Omit<BrowserVaultConsume, 'proof'>,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify([
      'visomi-vault-browser-consume-v1',
      encodeVaultBytes(pairingBytes(pairing)),
      input.nonce,
      input.issuedAt,
    ]),
  );
}

function deliveryLabel(input: BrowserVaultBinding): Uint8Array<ArrayBuffer> {
  const value = browserVaultBinding.parse(input);

  return new TextEncoder().encode(
    JSON.stringify([
      'visomi-vault-browser-delivery-v1',
      value.ownerUserId,
      value.personalScopeId,
      value.requestId,
      value.challenge,
      value.fingerprint,
      value.recipientEncryption,
      value.keyGeneration,
    ]),
  );
}

function assertEncryptionKey(key: CryptoKey): void {
  const algorithm = key.algorithm as Partial<RsaHashedKeyAlgorithm>;

  if (algorithm.name !== 'RSA-OAEP' || algorithm.modulusLength !== 3072 || algorithm.hash?.name !== 'SHA-256')
    throw new Error('invalid_device_encryption_key');
}

async function encryptionKey(crypto: Crypto, encoded: string): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey('spki', bytes(encoded), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'encrypt',
  ]);

  assertEncryptionKey(key);

  return key;
}

export async function createBrowserVaultPairing(
  crypto: Crypto,
  ownerUserId: string,
  personalScopeId: string,
  expiresAt: string,
): Promise<{ identity: DeviceIdentity; pairing: BrowserVaultPairing }> {
  const identity = await createDeviceIdentity(crypto);
  const signing = await crypto.subtle.exportKey('spki', identity.signing.publicKey);
  const encryption = await crypto.subtle.exportKey('spki', identity.encryption.publicKey);
  const value = browserVaultPairing.omit({ proof: true }).parse({
    version: 1,
    purpose: 'vault-browser-enrollment',
    requestId: crypto.randomUUID(),
    ownerUserId,
    personalScopeId,
    expiresAt,
    challenge: encodeVaultBytes(crypto.getRandomValues(new Uint8Array(32))),
    keys: {
      signing: encodeVaultBytes(new Uint8Array(signing)),
      encryption: encodeVaultBytes(new Uint8Array(encryption)),
    },
  });
  const proof = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.signing.privateKey,
    pairingBytes(value),
  );

  return { identity, pairing: browserVaultPairing.parse({ ...value, proof: encodeVaultBytes(new Uint8Array(proof)) }) };
}

async function verify(
  crypto: Crypto,
  signing: string,
  proof: string,
  message: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const key = await crypto.subtle.importKey('spki', bytes(signing), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'verify',
  ]);

  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes(proof), message);
}

/** Proof authenticates the context and recipient keys, not session authority or expiry. */
export async function verifyBrowserVaultPairing(crypto: Crypto, input: BrowserVaultPairing): Promise<boolean> {
  const result = browserVaultPairing.safeParse(input);

  if (!result.success) return false;
  try {
    await encryptionKey(crypto, result.data.keys.encryption);

    return await verify(crypto, result.data.keys.signing, result.data.proof, pairingBytes(result.data));
  } catch {
    return false;
  }
}

export async function browserVaultFingerprint(crypto: Crypto, input: BrowserVaultPairing): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', pairingBytes(browserVaultPairing.parse(input)));

  return encodeVaultBytes(new Uint8Array(digest));
}

export async function signBrowserVaultConsume(
  crypto: Crypto,
  key: CryptoKey,
  pairing: BrowserVaultPairing,
  input: Omit<BrowserVaultConsume, 'proof'>,
): Promise<BrowserVaultConsume> {
  const parsed = browserVaultConsume.omit({ proof: true }).parse(input);
  const proof = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    consumeBytes(browserVaultPairing.parse(pairing), parsed),
  );

  return browserVaultConsume.parse({ ...parsed, proof: encodeVaultBytes(new Uint8Array(proof)) });
}

export async function verifyBrowserVaultConsume(
  crypto: Crypto,
  input: BrowserVaultPairing,
  proof: BrowserVaultConsume,
): Promise<boolean> {
  const pairing = browserVaultPairing.safeParse(input);
  const consumption = browserVaultConsume.safeParse(proof);

  if (!pairing.success || !consumption.success) return false;
  try {
    return await verify(
      crypto,
      pairing.data.keys.signing,
      consumption.data.proof,
      consumeBytes(pairing.data, consumption.data),
    );
  } catch {
    return false;
  }
}

/** The caller owns and must erase the transient DEK bytes. */
export async function sealBrowserVaultKey(
  crypto: Crypto,
  keyBytes: Uint8Array<ArrayBuffer>,
  binding: BrowserVaultBinding,
): Promise<DeviceKeyEnvelope> {
  if (keyBytes.length !== 32) throw new Error('invalid_vault_key');
  const value = browserVaultBinding.parse(binding);
  const key = await encryptionKey(crypto, value.recipientEncryption);
  const ciphertext = await crypto.subtle.encrypt({ name: 'RSA-OAEP', label: deliveryLabel(value) }, key, keyBytes);

  return browserVaultDelivery.parse({ version: 1, ciphertext: encodeVaultBytes(new Uint8Array(ciphertext)) });
}

export async function openBrowserVaultKey(
  crypto: Crypto,
  key: CryptoKey,
  binding: BrowserVaultBinding,
  delivery: DeviceKeyEnvelope,
): Promise<Uint8Array<ArrayBuffer>> {
  assertEncryptionKey(key);
  const input = browserVaultDelivery.parse(delivery);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP', label: deliveryLabel(binding) },
    key,
    bytes(input.ciphertext),
  );
  const output = new Uint8Array(plaintext);

  if (output.length !== 32) {
    output.fill(0);
    throw new Error('invalid_vault_key');
  }

  return output;
}
