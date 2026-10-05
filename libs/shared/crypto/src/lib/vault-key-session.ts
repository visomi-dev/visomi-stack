import type { VaultKeyEnvelope, VaultKeyEnvelopeMetadata } from './vault-key-contract';
import { encodeRecoveryBytes, sealVaultKey } from './vault-key-envelope';
import { sealBrowserVaultKey } from './vault-browser-enrollment';
import type { BrowserVaultBinding } from './vault-browser-contract';
import type { DeviceKeyEnvelope } from './device-key-contract';

type SessionKeys = { dataKey: CryptoKey; capsuleKey: CryptoKey; iv: Uint8Array<ArrayBuffer>; capsule: ArrayBuffer };
const capsuleAad = new TextEncoder().encode('visomi-vault-session-capsule-v1');

/** Lifecycle custody only: hostile JavaScript can still use an unlocked session. */
export class VaultKeySession {
  private keys: SessionKeys | undefined;
  private epoch = 0;

  constructor(private readonly crypto: Crypto) {}

  async unlock(rawDek: Uint8Array): Promise<void> {
    this.lock();
    const epoch = this.epoch;

    if (rawDek.length !== 32) {
      throw new Error('invalid_vault_key');
    }

    const bytes = new Uint8Array(rawDek);

    try {
      const dataKey = await this.crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
      const capsuleKey = await this.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
      const iv = this.crypto.getRandomValues(new Uint8Array(12));
      const capsule = await this.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: capsuleAad, tagLength: 128 },
        capsuleKey,
        bytes,
      );

      this.assertEpoch(epoch);
      this.keys = { dataKey, capsuleKey, iv, capsule };
    } finally {
      bytes.fill(0);
    }
  }

  lock(): void {
    this.epoch += 1;
    this.keys = undefined;
  }

  /** Borrowers must also discard their reference when the owning lifecycle locks. */
  borrowDataKey(): CryptoKey {
    if (!this.keys) {
      throw new Error('vault_locked');
    }

    return this.keys.dataKey;
  }

  async wrapVaultKey(wrappingKey: CryptoKey, metadata: VaultKeyEnvelopeMetadata): Promise<VaultKeyEnvelope> {
    const result = await this.withBytes((bytes) => sealVaultKey(this.crypto, wrappingKey, bytes, metadata));

    return result;
  }

  /** The caller must require explicit consent and fresh, purpose-bound reauthentication. */
  async exportRecovery(): Promise<string> {
    const result = await this.withBytes((bytes) => Promise.resolve(encodeRecoveryBytes(bytes)));

    return result;
  }

  /** The caller owns explicit recipient comparison and fresh approval authorization. */
  async deliverToBrowser(binding: BrowserVaultBinding): Promise<DeviceKeyEnvelope> {
    return this.withBytes((bytes) => sealBrowserVaultKey(this.crypto, bytes, binding));
  }

  private assertEpoch(epoch: number): void {
    if (epoch !== this.epoch) {
      throw new Error('vault_locked');
    }
  }

  private async withBytes<T>(operation: (bytes: Uint8Array<ArrayBuffer>) => Promise<T>): Promise<T> {
    const keys = this.keys;
    const epoch = this.epoch;

    if (!keys) {
      throw new Error('vault_locked');
    }

    const result = await this.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: keys.iv, additionalData: capsuleAad, tagLength: 128 },
      keys.capsuleKey,
      keys.capsule,
    );
    const bytes = new Uint8Array(result);

    try {
      this.assertEpoch(epoch);
      const output = await operation(bytes);

      this.assertEpoch(epoch);

      return output;
    } finally {
      bytes.fill(0);
    }
  }
}
