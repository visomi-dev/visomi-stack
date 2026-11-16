import { CryptoContractError } from '@visomi-stack/shared-persistence';

import type { DeviceIdentity } from './devices';


/** Capture only during provisioning, encrypt with the unlocked vault, then use nonextractable operational keys. */
export async function provisionDeviceIdentity(
  crypto: Crypto,
  protect: (material: Uint8Array) => Promise<void>,
): Promise<DeviceIdentity> {
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const encryption = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
  const signingPrivate = await crypto.subtle.exportKey('pkcs8', signing.privateKey);
  const encryptionPrivate = await crypto.subtle.exportKey('pkcs8', encryption.privateKey);
  const signingPublic = await crypto.subtle.exportKey('spki', signing.publicKey);
  const encryptionPublic = await crypto.subtle.exportKey('spki', encryption.publicKey);
  const parts = [signingPrivate, encryptionPrivate, signingPublic, encryptionPublic].map(
    (value) => new Uint8Array(value),
  );
  const material = new Uint8Array(20 + parts.reduce((sum, value) => sum + value.length, 0));
  const header = new DataView(material.buffer);

  header.setUint32(0, 1);
  let offset = 20;

  parts.forEach((part, index) => {
    header.setUint32(4 + index * 4, part.length);
    material.set(part, offset);
    offset += part.length;
  });

  try {
    const operational = await restoreDeviceIdentity(crypto, material);

    await protect(material);

    return operational;
  } finally {
    material.fill(0);
    parts.forEach((value) => value.fill(0));
  }
}

/** Input must come from authenticated vault decryption. Ownership/generation is checked by that envelope's context. */
export async function restoreDeviceIdentity(crypto: Crypto, material: Uint8Array): Promise<DeviceIdentity> {
  const copy = Uint8Array.from(material);

  try {
    if (copy.length < 20 || copy.length > 8192) {
      throw new Error();
    }

    const header = new DataView(copy.buffer);

    if (header.getUint32(0) !== 1) {
      throw new Error();
    }

    let offset = 20;
    const parts = Array.from({ length: 4 }, (_, index) => {
      const length = header.getUint32(4 + index * 4);
      const part = copy.subarray(offset, offset + length);

      offset += length;

      if (!length || part.length !== length) {
        throw new Error();
      }

      return part;
    });

    if (offset !== copy.length || parts[2].length !== 91 || parts[3].length !== 422) {
      throw new Error();
    }

    const signingPrivate = await crypto.subtle.importKey(
      'pkcs8',
      parts[0],
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    const encryptionPrivate = await crypto.subtle.importKey(
      'pkcs8',
      parts[1],
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    );
    const signingPublic = await crypto.subtle.importKey(
      'spki',
      parts[2],
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify'],
    );
    const encryptionPublic = await crypto.subtle.importKey(
      'spki',
      parts[3],
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['encrypt'],
    );
    const rsa = encryptionPrivate.algorithm as RsaHashedKeyAlgorithm;
    const rsaPublic = encryptionPublic.algorithm as RsaHashedKeyAlgorithm;

    if (
      [rsa, rsaPublic].some(
        (value) =>
          value.modulusLength !== 3072 || value.hash.name !== 'SHA-256' || value.publicExponent.toString() !== '1,0,1',
      )
    ) {
      throw new Error();
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const proof = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingPrivate, challenge);
    const verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, signingPublic, proof, challenge);
    const sealed = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP', label: new TextEncoder().encode('visomi.device-custody.v1') },
      encryptionPublic,
      challenge,
    );
    const opened = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP', label: new TextEncoder().encode('visomi.device-custody.v1') },
      encryptionPrivate,
      sealed,
    );
    const bytes = new Uint8Array(opened);
    const valid =
      verified && bytes.length === challenge.length && bytes.every((value, index) => value === challenge[index]);

    bytes.fill(0);
    challenge.fill(0);

    if (!valid) {
      throw new Error();
    }

    return {
      signing: { privateKey: signingPrivate, publicKey: signingPublic },
      encryption: { privateKey: encryptionPrivate, publicKey: encryptionPublic },
    };
  } catch {
    throw new CryptoContractError('key-invalid');
  } finally {
    copy.fill(0);
  }
}
