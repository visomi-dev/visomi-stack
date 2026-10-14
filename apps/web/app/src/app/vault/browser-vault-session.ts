import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Service, signal } from '@angular/core';
import { firstValueFrom, Subject, takeUntil, timeout } from 'rxjs';

import { Auth } from '../shared/auth/auth';
import { Deps } from '../shared/deps';
import type { AuthUser } from '../shared/auth/auth.models';

import { VaultSession } from './vault-session';
import type { VaultBorrower, VaultState } from './vault-session';

import type {
  BrowserVaultBinding,
  DeviceKeyEnvelope,
  VaultKeyEnvelope,
  VaultKeyEnvelopeMetadata,
  VaultKeySession,
} from 'shared-crypto';

const idleLimit = 15 * 60_000;

@Service()
export class BrowserVaultSession extends VaultSession {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(Auth);
  private readonly http = inject(HttpClient);
  private readonly deps = inject(Deps);

  private readonly currentState = signal<VaultState>('locked');
  private readonly currentGeneration = signal(0);

  private readonly authIdentity = computed(() => {
    const owner = this.auth.user();

    return this.auth.isAuthenticated() && owner ? this.identity(owner) : null;
  });

  readonly state = this.currentState.asReadonly();
  readonly generation = this.currentGeneration.asReadonly();

  private readonly borrowers = new Set<VaultBorrower>();
  private readonly cancellations = new Set<() => void>();
  private readonly invalidated = new Subject<void>();

  private keys: VaultKeySession | undefined;
  private owner: AuthUser | undefined;
  private lastActivity = 0;
  private channel: BroadcastChannel | undefined;
  private stopLifecycle: (() => void) | undefined;
  private checking = false;
  private sourcePinMethodId: string | undefined;
  private sourcePrfMethodId: string | undefined;
  private lastAuthorityCheck = 0;

  startLifecycle(): () => void {
    this.stopLifecycle?.();
    const browser = this.document.defaultView;

    if (!browser) return () => undefined;
    const channel =
      typeof browser.BroadcastChannel === 'function' ? new browser.BroadcastChannel('visomi-vault-lock-v1') : undefined;

    this.channel = channel;
    if (channel) channel.onmessage = () => this.lock(false);
    const activity = (event: Event) => {
      this.recheck();
      if (event.isTrusted) this.lastActivity = this.now();
    };
    const resume = () => {
      this.recheck();
      if (this.owner && this.document.visibilityState !== 'hidden') void this.validateAuthority();
    };
    const exit = () => this.lock();
    const timer = browser.setInterval(() => {
      this.recheck();
      if (this.owner && this.now() - this.lastAuthorityCheck >= 60_000) void this.validateAuthority();
    }, 1000);

    browser.addEventListener('pointerdown', activity);
    browser.addEventListener('keydown', activity);
    browser.addEventListener('focus', resume);
    browser.addEventListener('pagehide', exit);
    this.document.addEventListener('visibilitychange', resume);
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      browser.clearInterval(timer);
      browser.removeEventListener('pointerdown', activity);
      browser.removeEventListener('keydown', activity);
      browser.removeEventListener('focus', resume);
      browser.removeEventListener('pagehide', exit);
      this.document.removeEventListener('visibilitychange', resume);
      channel?.close();
      if (this.channel === channel) this.channel = undefined;
      if (this.stopLifecycle === stop) this.stopLifecycle = undefined;
      this.lock(false);
    };

    this.stopLifecycle = stop;

    return stop;
  }

  lock(broadcast = true): void {
    this.currentGeneration.update((generation) => generation + 1);
    this.keys?.lock();
    this.keys = undefined;
    this.owner = undefined;
    this.sourcePinMethodId = undefined;
    this.sourcePrfMethodId = undefined;
    this.invalidated.next();
    this.currentState.set('locked');
    // A defective consumer must not prevent the other consumers from dropping keys or cancelling work.
    for (const borrower of this.borrowers) {
      try {
        borrower.lock();
      } catch {
        /* Custody has already been cleared. */
      }
    }
    this.borrowers.clear();
    const cancellations = [...this.cancellations];

    this.cancellations.clear();
    for (const cancel of cancellations) {
      try {
        cancel();
      } catch {
        /* Continue cancelling independently owned work. */
      }
    }
    if (broadcast) this.channel?.postMessage({ locked: true });
  }

  async unlockRecovery(recovery: string): Promise<void> {
    const owner = this.requireOwner();
    const generation = this.generation();
    const { decodeRecoveryBytes } = await this.deps.vaultUnlock();

    this.assertCurrent(owner, generation);
    const bytes = decodeRecoveryBytes(recovery);

    try {
      await this.install(owner, bytes, generation);
    } finally {
      bytes.fill(0);
    }
  }

  async unlockEnvelope(envelope: VaultKeyEnvelope, key: CryptoKey, generation: number): Promise<void> {
    const owner = this.requireOwner();
    const crypto = this.document.defaultView?.crypto;

    if (!crypto || envelope.binding.ownerUserId !== owner.id || envelope.binding.personalScopeId !== owner.accountId) {
      throw new Error('vault_scope_mismatch');
    }
    this.assertCurrent(owner, generation);
    const { openVaultKey } = await this.deps.vaultUnlock();

    this.assertCurrent(owner, generation);
    const bytes = await openVaultKey(crypto, key, envelope, envelope.binding);

    try {
      await this.install(
        owner,
        bytes,
        generation,
        envelope.binding.methodKind === 'local-pin' ? envelope.binding.methodId : undefined,
        envelope.binding.methodKind === 'passkey-prf' ? envelope.binding.methodId : undefined,
      );
    } finally {
      bytes.fill(0);
    }
  }

  borrow(borrower: VaultBorrower): CryptoKey {
    const keys = this.requireKeys();

    this.borrowers.add(borrower);

    return keys.borrowDataKey();
  }

  release(borrower: VaultBorrower): void {
    this.borrowers.delete(borrower);
    borrower.lock();
  }

  onLock(cancel: () => void): () => void {
    this.cancellations.add(cancel);

    return () => this.cancellations.delete(cancel);
  }

  async wrap(key: CryptoKey, metadata: VaultKeyEnvelopeMetadata): Promise<VaultKeyEnvelope> {
    const keys = this.requireKeys();
    const owner = this.owner!;
    const generation = this.generation();

    if (metadata.binding.ownerUserId !== owner.id || metadata.binding.personalScopeId !== owner.accountId) {
      throw new Error('vault_scope_mismatch');
    }
    const result = await keys.wrapVaultKey(key, metadata);

    this.assertCurrent(owner, generation);

    return result;
  }

  async exportRecovery(grantId: string): Promise<string> {
    const keys = this.requireKeys();
    const owner = this.owner!;
    const generation = this.generation();

    await firstValueFrom(
      this.http
        .post(`/api/vault-unlock/${owner.accountId}/recovery-export`, { grantId })
        .pipe(takeUntil(this.invalidated), timeout(10_000)),
    );
    this.assertCurrent(owner, generation);
    const result = await keys.exportRecovery();

    this.assertCurrent(owner, generation);

    return result;
  }

  recordPinEnrollment(methodId: string): void {
    this.requireKeys();
    // The caller has completed reauthentication, profile CAS, wrap/open validation and local persistence.
    if (this.sourcePinMethodId) this.sourcePinMethodId = methodId;
  }

  async deliverToBrowser(binding: BrowserVaultBinding): Promise<DeviceKeyEnvelope> {
    const keys = this.requireKeys();
    const owner = this.owner!;
    const generation = this.generation();

    if (binding.ownerUserId !== owner.id || binding.personalScopeId !== owner.accountId)
      throw new Error('vault_scope_mismatch');
    const result = await keys.deliverToBrowser(binding);

    this.assertCurrent(owner, generation);

    return result;
  }

  async unlockBrowserDelivery(
    binding: BrowserVaultBinding,
    key: CryptoKey,
    envelope: DeviceKeyEnvelope,
    generation: number,
  ): Promise<void> {
    const owner = this.requireOwner();
    const crypto = this.document.defaultView?.crypto;

    if (!crypto || binding.ownerUserId !== owner.id || binding.personalScopeId !== owner.accountId)
      throw new Error('vault_scope_mismatch');
    this.assertCurrent(owner, generation);
    const { openBrowserVaultKey } = await this.deps.vaultUnlock();

    this.assertCurrent(owner, generation);
    const bytes = await openBrowserVaultKey(crypto, key, binding, envelope);

    try {
      await this.install(owner, bytes, generation);
    } finally {
      bytes.fill(0);
    }
  }

  private async install(
    owner: AuthUser,
    bytes: Uint8Array,
    generation: number,
    pinMethodId?: string,
    prfMethodId?: string,
  ): Promise<void> {
    this.assertCurrent(owner, generation);
    this.lock(false);
    const epoch = this.generation();
    const crypto = this.document.defaultView?.crypto;

    if (!crypto) throw new Error('vault_locked');
    const { VaultKeySession, verifyVaultPinProfileKey } = await this.deps.vaultUnlock();

    this.assertCurrent(owner, epoch);
    const keys = new VaultKeySession(crypto);

    this.currentState.set('unlocking');

    try {
      // Forced lookup rejects stale/restricted sessions; its transient failure never installs keys.
      await this.auth.ensureSessionLoaded(true);
      this.assertCurrent(owner, epoch);
      await keys.unlock(bytes);
      this.assertCurrent(owner, epoch);
      const profile = await this.readProfile(owner);

      this.assertCurrent(owner, epoch);
      if (pinMethodId && profile?.binding.methodId !== pinMethodId) throw new Error('vault_pin_changed');
      if (pinMethodId && (await this.readPinMethodId(owner)) !== pinMethodId) throw new Error('vault_pin_changed');
      if (prfMethodId && !(await this.hasPrfMethod(owner, prfMethodId))) throw new Error('vault_method_unavailable');
      if (profile)
        await verifyVaultPinProfileKey(crypto, keys.borrowDataKey(), profile, {
          ownerUserId: owner.id,
          personalScopeId: owner.accountId,
          methodId: profile.binding.methodId,
        });
      this.assertCurrent(owner, epoch);
      this.keys = keys;
      this.owner = owner;
      this.sourcePinMethodId = pinMethodId;
      this.sourcePrfMethodId = prfMethodId;
      this.lastActivity = this.now();
      this.lastAuthorityCheck = this.lastActivity;
      this.currentState.set('unlocked');
    } catch (error) {
      keys.lock();
      if (epoch === this.generation()) this.lock(false);
      throw error;
    }
  }

  private requireOwner(): AuthUser {
    const owner = this.auth.user();

    if (!owner || !this.auth.isAuthenticated()) throw new Error('vault_locked');

    return owner;
  }

  private assertCurrent(owner: AuthUser, generation: number): void {
    const current = this.requireOwner();

    if (generation !== this.generation() || this.identity(current) !== this.identity(owner))
      throw new Error('vault_locked');
  }

  private requireKeys(): VaultKeySession {
    this.recheck();
    if (!this.keys || this.state() !== 'unlocked') throw new Error('vault_locked');

    return this.keys;
  }

  private recheck(): void {
    if (
      this.owner &&
      (this.authIdentity() !== this.identity(this.owner) || this.now() - this.lastActivity >= idleLimit)
    )
      this.lock();
  }

  private async validateAuthority(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    const generation = this.generation();

    try {
      await this.auth.ensureSessionLoaded(true);
      this.recheck();
      if (generation === this.generation() && this.owner) {
        const pinMethodId = await this.readPinMethodId(this.owner);

        if (generation === this.generation() && this.sourcePinMethodId && pinMethodId !== this.sourcePinMethodId)
          this.lock();
        const owner = this.owner;
        const prfMethodId = this.sourcePrfMethodId;

        if (generation === this.generation() && owner && prfMethodId) {
          const active = await this.hasPrfMethod(owner, prfMethodId);

          if (generation === this.generation() && !active) this.lock();
        }
      }
    } catch {
      if (generation === this.generation()) this.lock();
    } finally {
      this.checking = false;
      this.lastAuthorityCheck = this.now();
    }
  }

  private async readProfile(owner: AuthUser) {
    const result = await firstValueFrom(
      this.http
        .get<unknown>(`/api/vault-unlock/${owner.accountId}/pin-profile`, { transferCache: false })
        .pipe(takeUntil(this.invalidated), timeout(10_000)),
    );

    if (typeof result !== 'object' || result === null || !('data' in result)) throw new Error('vault_profile_invalid');
    const { vaultPinProfile } = await this.deps.vaultUnlock();

    return vaultPinProfile.nullable().parse(result.data);
  }

  private async readPinMethodId(owner: AuthUser): Promise<string | null> {
    const result = await firstValueFrom(
      this.http
        .get<unknown>(`/api/vault-unlock/${owner.accountId}/config`, { transferCache: false })
        .pipe(takeUntil(this.invalidated), timeout(10_000)),
    );

    if (
      typeof result !== 'object' ||
      result === null ||
      !('data' in result) ||
      typeof result.data !== 'object' ||
      result.data === null ||
      !('pinMethodId' in result.data)
    )
      throw new Error('vault_config_invalid');
    const methodId = result.data.pinMethodId;

    if (methodId !== null && (typeof methodId !== 'string' || !/^[0-9a-f-]{36}$/.test(methodId)))
      throw new Error('vault_config_invalid');

    return methodId;
  }

  private identity(owner: AuthUser): string {
    return JSON.stringify([owner.id, owner.accountId, owner.authVersion ?? 1]);
  }

  private async hasPrfMethod(owner: AuthUser, methodId: string): Promise<boolean> {
    const result = await firstValueFrom(
      this.http
        .get<unknown>(`/api/vault-unlock/${owner.accountId}/methods`, { transferCache: false })
        .pipe(takeUntil(this.invalidated), timeout(10_000)),
    );

    if (
      typeof result !== 'object' ||
      result === null ||
      !('data' in result) ||
      !Array.isArray(result.data) ||
      result.data.length > 20
    )
      throw new Error('vault_config_invalid');

    return result.data.some(
      (method: unknown) =>
        typeof method === 'object' && method !== null && 'methodId' in method && method.methodId === methodId,
    );
  }

  private now(): number {
    // Elapsed-time custody uses a monotonic clock, not calendar arithmetic or a serializable application date.
    return this.document.defaultView?.performance.now() ?? 0;
  }

  private readonly lockDepartingIdentity = effect((cleanup) => {
    this.authIdentity();
    cleanup(() => this.lock());
  });
}
