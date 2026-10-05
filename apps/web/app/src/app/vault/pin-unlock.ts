import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Injectable } from '@angular/core';
import { firstValueFrom, Subject, takeUntil, timeout } from 'rxjs';
import { z } from 'zod';

import { Auth } from '../shared/auth/auth';

import { VaultSession } from './vault-session';

import { PinKeyDerivation, UnlockStorage } from 'frontend-shared';
import {
  encodeVaultBytes,
  localPinEnvelope,
  matchesVaultPinProfile,
  openVaultKey,
  sealVaultPinProfile,
  vaultPinProfile,
  verifyVaultPinProfileKey,
} from 'shared-crypto';

/** The short PIN and PIN-wrapped key stay in this browser, never in API requests or sync. */
@Injectable()
export class PinUnlock {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(Auth);
  private readonly http = inject(HttpClient);
  private readonly vault = inject(VaultSession);

  private readonly identity = computed(() => {
    const owner = this.auth.user();

    return this.auth.isAuthenticated() && owner
      ? JSON.stringify([owner.id, owner.accountId, owner.authVersion ?? 1])
      : null;
  });

  private readonly cancelled = new Subject<void>();

  private derivation: PinKeyDerivation | undefined;
  private controller: AbortController | undefined;

  cancel(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.derivation?.cancel();
    this.cancelled.next();
  }

  async enroll(pin: string, grantId: string, replaceCanonical = false): Promise<void> {
    this.cancel();
    const { owner, browser, storage, derivation } = this.context();
    const generation = this.vault.generation();
    const controller = new AbortController();

    this.controller = controller;
    const borrower = { lock: () => controller.abort() };
    const dataKey = this.vault.borrow(borrower);
    const release = this.vault.onLock(() => this.cancel());

    try {
      await storage.exclusive(owner.id, owner.accountId, async () => {
        const current = await this.profile(owner.accountId);

        this.assertCurrent(generation, controller);
        if (
          current &&
          !replaceCanonical &&
          !(await matchesVaultPinProfile(browser.crypto, dataKey, pin, current, current.binding))
        ) {
          throw new Error('vault_pin_mismatch');
        }
        const profile =
          !current || replaceCanonical
            ? await sealVaultPinProfile(browser.crypto, dataKey, pin, {
                ownerUserId: owner.id,
                personalScopeId: owner.accountId,
                methodId: browser.crypto.randomUUID(),
              })
            : current;
        const metadata = {
          version: 1 as const,
          binding: {
            ownerUserId: owner.id,
            personalScopeId: owner.accountId,
            methodId: profile.binding.methodId,
            keyGeneration: 1 as const,
            methodKind: 'local-pin' as const,
            browserId: browser.crypto.randomUUID(),
          },
          hkdfSalt: encodeVaultBytes(browser.crypto.getRandomValues(new Uint8Array(32))),
          argon2Salt: encodeVaultBytes(browser.crypto.getRandomValues(new Uint8Array(16))),
          kdfProfile: 'pin-argon2id-hkdf-sha256-v1' as const,
        };
        const placeholder = localPinEnvelope.parse({ ...metadata, iv: 'A'.repeat(16), ciphertext: 'A'.repeat(64) });
        const wrappingKey = await derivation.derive(pin, placeholder, controller.signal);

        this.assertCurrent(generation, controller);
        const envelope = localPinEnvelope.parse(await this.vault.wrap(wrappingKey, metadata));
        const bytes = await openVaultKey(browser.crypto, wrappingKey, envelope, envelope.binding);

        try {
          const candidate = await browser.crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
            'encrypt',
            'decrypt',
          ]);

          await verifyVaultPinProfileKey(browser.crypto, candidate, profile, profile.binding);
        } finally {
          bytes.fill(0);
        }
        this.assertCurrent(generation, controller);
        await firstValueFrom(
          this.http
            .post(`/api/vault-unlock/${owner.accountId}/local-method`, {
              grantId,
              expectedMethodId: current?.binding.methodId ?? null,
              ...(!current || replaceCanonical ? { profile } : {}),
            })
            .pipe(takeUntil(this.cancelled), timeout(10_000)),
        );
        this.assertCurrent(generation, controller);
        await storage.replace({ envelope, consent: true, failures: 0, cooldownUntil: 0 });
        this.assertCurrent(generation, controller);
        this.vault.recordPinEnrollment(profile.binding.methodId);
      });
    } finally {
      release();
      this.vault.release(borrower);
      if (this.controller === controller) this.controller = undefined;
    }
  }

  async unlock(pin: string): Promise<void> {
    this.cancel();
    const { owner, storage, derivation } = this.context();
    const generation = this.vault.generation();
    const controller = new AbortController();

    this.controller = controller;
    try {
      await storage.exclusive(owner.id, owner.accountId, async () => {
        const local = await storage.read(owner.id, owner.accountId);

        if (!local) throw new Error('local_unlock_unavailable');
        const profile = await this.profile(owner.accountId);

        if (profile?.binding.methodId !== local.envelope.binding.methodId) {
          await storage.remove(owner.id, owner.accountId);
          throw new Error('vault_pin_changed');
        }
        this.assertCurrent(generation, controller);
        // No derivation before consuming the durable, cross-device attempt budget.
        await firstValueFrom(
          this.http
            .post(`/api/vault-unlock/${owner.accountId}/pin-attempt`, {
              methodId: local.envelope.binding.methodId,
            })
            .pipe(takeUntil(this.cancelled), timeout(10_000)),
        );
        this.assertCurrent(generation, controller);
        const release = this.vault.onLock(() => this.cancel());
        let key: CryptoKey;

        try {
          key = await derivation.derive(pin, local.envelope, controller.signal);
        } finally {
          release();
        }
        this.assertCurrent(generation, controller);
        await this.vault.unlockEnvelope(local.envelope, key, generation);
      });
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }

  async remove(grantId: string): Promise<void> {
    this.cancel();
    const { owner, storage } = this.context();
    const profile = await this.profile(owner.accountId);

    if (!profile) return;
    const identity = this.identity();

    await firstValueFrom(
      this.http
        .delete(`/api/vault-unlock/${owner.accountId}/local-method`, {
          body: { grantId, expectedMethodId: profile.binding.methodId },
        })
        .pipe(takeUntil(this.cancelled), timeout(10_000)),
    );
    if (identity !== this.identity()) throw new Error('vault_locked');
    this.vault.lock();
    await storage.exclusive(owner.id, owner.accountId, () => storage.remove(owner.id, owner.accountId));
  }

  private context() {
    const owner = this.auth.user();
    const browser = this.document.defaultView;

    if (!owner || !this.auth.isAuthenticated() || !browser?.indexedDB || !browser.navigator.locks) {
      throw new Error('local_unlock_unavailable');
    }
    const storage = new UnlockStorage(browser.indexedDB, browser.navigator.locks);

    this.derivation ??= new PinKeyDerivation(
      () => new browser.Worker(new URL('vault-pin-worker.js', this.document.baseURI), { type: 'module' }),
    );

    return { owner, browser, storage, derivation: this.derivation };
  }

  private assertCurrent(generation: number, controller: AbortController): void {
    if (controller.signal.aborted || generation !== this.vault.generation() || !this.identity()) {
      throw new Error('vault_locked');
    }
  }

  private async profile(scopeId: string) {
    const input = await firstValueFrom(
      this.http
        .get<unknown>(`/api/vault-unlock/${scopeId}/pin-profile`, { transferCache: false })
        .pipe(takeUntil(this.cancelled), timeout(10_000)),
    );

    return z.object({ data: vaultPinProfile.nullable() }).parse(input).data;
  }

  private readonly cancelDepartingIdentity = effect((cleanup) => {
    this.identity();
    cleanup(() => this.cancel());
  });
}
