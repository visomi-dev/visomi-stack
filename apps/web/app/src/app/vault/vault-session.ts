import type { Signal } from '@angular/core';

import type { BrowserVaultBinding, DeviceKeyEnvelope, VaultKeyEnvelope, VaultKeyEnvelopeMetadata } from 'shared-crypto';

export type VaultState = 'locked' | 'unlocking' | 'unlocked';
export type VaultBorrower = { lock(): void };

/** Account authentication is never proof that the local encryption key is unlocked. */
export abstract class VaultSession {
  abstract readonly state: Signal<VaultState>;
  abstract readonly generation: Signal<number>;

  abstract startLifecycle(): () => void;

  abstract lock(broadcast?: boolean): void;

  abstract unlockRecovery(recovery: string): Promise<void>;

  abstract unlockEnvelope(envelope: VaultKeyEnvelope, key: CryptoKey, generation: number): Promise<void>;

  abstract borrow(borrower: VaultBorrower): CryptoKey;

  abstract release(borrower: VaultBorrower): void;

  abstract onLock(cancel: () => void): () => void;

  abstract wrap(key: CryptoKey, metadata: VaultKeyEnvelopeMetadata): Promise<VaultKeyEnvelope>;

  abstract exportRecovery(grantId: string): Promise<string>;

  abstract recordPinEnrollment(methodId: string): void;

  abstract deliverToBrowser(binding: BrowserVaultBinding): Promise<DeviceKeyEnvelope>;

  abstract unlockBrowserDelivery(
    binding: BrowserVaultBinding,
    key: CryptoKey,
    envelope: DeviceKeyEnvelope,
    generation: number,
  ): Promise<void>;
}
