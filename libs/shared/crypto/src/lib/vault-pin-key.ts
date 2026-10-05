import { argon2id } from 'hash-wasm';

import { localPinEnvelope } from './vault-key-contract';
import type { LocalPinEnvelope } from './vault-key-contract';
import { decodeVaultBytes, vaultKeyBindingBytes } from './vault-key-envelope';
import { isVaultPinValid } from './vault-pin-policy';

export { isVaultPinValid } from './vault-pin-policy';

/** Fixed, versioned profile. Run in a dedicated browser worker, never on the API. */
export async function derivePinWrappingKey(
  crypto: Crypto,
  pin: string,
  metadata: Omit<LocalPinEnvelope, 'iv' | 'ciphertext'>,
): Promise<CryptoKey> {
  const envelope = localPinEnvelope.parse({ ...metadata, iv: 'A'.repeat(16), ciphertext: 'A'.repeat(64) });

  if (!isVaultPinValid(pin)) {
    throw new Error('invalid_vault_pin');
  }

  const password = new TextEncoder().encode(pin);
  let hash: Uint8Array<ArrayBufferLike> | undefined;

  try {
    const output = await argon2id({
      password,
      salt: decodeVaultBytes(envelope.argon2Salt, 16),
      memorySize: 65_536,
      iterations: 3,
      parallelism: 1,
      hashLength: 32,
      outputType: 'binary',
    });

    hash = output;
    const material = new Uint8Array(output);

    try {
      const inputKey = await crypto.subtle.importKey('raw', material, 'HKDF', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: decodeVaultBytes(envelope.hkdfSalt, 32),
          info: vaultKeyBindingBytes(envelope.binding),
        },
        inputKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );

      return key;
    } finally {
      material.fill(0);
    }
  } finally {
    password.fill(0);
    hash?.fill(0);
  }
}
