import { Service, signal } from '@angular/core';

import { VaultSession } from './vault-session';
import type { VaultBorrower, VaultState } from './vault-session';

import type { BrowserVaultBinding, DeviceKeyEnvelope, VaultKeyEnvelope, VaultKeyEnvelopeMetadata } from 'shared-crypto';

@Service()
export class ServerVaultSession extends VaultSession {
  readonly state = signal<VaultState>('locked').asReadonly();
  readonly generation = signal(0).asReadonly();

  startLifecycle(): () => void {
    return () => undefined;
  }

  lock(): void {
    /* SSR never owns keys or browser storage. */
  }

  unlockRecovery(_recovery: string): Promise<void> {
    return Promise.reject(new Error('vault_locked'));
  }

  unlockEnvelope(_envelope: VaultKeyEnvelope, _key: CryptoKey, _generation: number): Promise<void> {
    return Promise.reject(new Error('vault_locked'));
  }

  borrow(_borrower: VaultBorrower): CryptoKey {
    throw new Error('vault_locked');
  }

  release(_borrower: VaultBorrower): void {
    /* No borrowers can be registered on the server. */
  }

  onLock(_cancel: () => void): () => void {
    return () => undefined;
  }

  wrap(_key: CryptoKey, _metadata: VaultKeyEnvelopeMetadata): Promise<VaultKeyEnvelope> {
    return Promise.reject(new Error('vault_locked'));
  }

  exportRecovery(_grantId: string): Promise<string> {
    return Promise.reject(new Error('vault_locked'));
  }

  recordPinEnrollment(_methodId: string): void {
    throw new Error('vault_locked');
  }

  deliverToBrowser(_binding: BrowserVaultBinding): Promise<DeviceKeyEnvelope> {
    return Promise.reject(new Error('vault_locked'));
  }

  unlockBrowserDelivery(
    _binding: BrowserVaultBinding,
    _key: CryptoKey,
    _envelope: DeviceKeyEnvelope,
    _generation: number,
  ): Promise<void> {
    return Promise.reject(new Error('vault_locked'));
  }
}
