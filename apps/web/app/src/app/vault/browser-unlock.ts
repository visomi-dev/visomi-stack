import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { DateTime } from 'luxon';
import { firstValueFrom, Subject, takeUntil, timeout } from 'rxjs';
import { z } from 'zod';

import { Auth } from '../shared/auth/auth';

import { VaultSession } from './vault-session';

import {
  browserVaultPairing,
  browserVaultDelivery,
  browserVaultFingerprint,
  createBrowserVaultPairing,
  signBrowserVaultConsume,
  verifyBrowserVaultPairing,
} from 'shared-crypto';
import type { BrowserVaultBinding, BrowserVaultPairing, DeviceIdentity } from 'shared-crypto';

export type BrowserRecipient = { pairing: BrowserVaultPairing; fingerprint: string };
export type BrowserRequest = { requestId: string; fingerprint: string; expiresAt: string };

/** Route-owned non-extractable recipient keys exist only until delivery, cancellation or expiry. */
@Injectable()
export class BrowserUnlock {
  private readonly document = inject(DOCUMENT);
  private readonly http = inject(HttpClient);
  private readonly auth = inject(Auth);
  private readonly vault = inject(VaultSession);
  private readonly destroyRef = inject(DestroyRef);

  private readonly currentRequest = signal<BrowserRequest | null>(null);

  private readonly identity = computed(() => {
    const owner = this.auth.user();

    return this.auth.isAuthenticated() && owner
      ? JSON.stringify([owner.id, owner.accountId, owner.authVersion ?? 1])
      : null;
  });

  readonly request = this.currentRequest.asReadonly();

  private readonly cancelled = new Subject<void>();

  private recipient: DeviceIdentity | undefined;
  private pairing: BrowserVaultPairing | undefined;
  private epoch = 0;
  private timer: number | undefined;
  private releaseLock: (() => void) | undefined;
  private receiving = false;

  constructor() {
    this.destroyRef.onDestroy(() => this.cancel());
  }

  cancel(): void {
    const pairing = this.pairing;
    const receiving = this.receiving;

    this.discard();
    if (receiving) this.vault.lock();
    if (pairing) {
      // Keys are already discarded. A failed remote cancellation still expires within ten minutes.
      void firstValueFrom(
        this.http.delete(`${this.base(pairing.personalScopeId)}/${pairing.requestId}`).pipe(timeout(10_000)),
      ).catch(() => undefined);
    }
  }

  async begin(): Promise<void> {
    this.cancel();
    const context = this.context();

    if (this.vault.state() !== 'locked') throw new Error('vault_already_unlocked');
    this.releaseLock = this.vault.onLock(() => this.cancel());
    try {
      const value = await createBrowserVaultPairing(
        context.crypto,
        context.owner.id,
        context.owner.accountId,
        DateTime.utc().plus({ minutes: 10 }).toISO(),
      );

      this.assertCurrent(context);
      this.recipient = value.identity;
      this.pairing = value.pairing;
      const fingerprint = await browserVaultFingerprint(context.crypto, value.pairing);

      this.assertCurrent(context);
      const result = await firstValueFrom(
        this.http
          .post<unknown>(this.base(context.owner.accountId), { pairing: value.pairing })
          .pipe(takeUntil(this.cancelled), timeout(10_000)),
      );
      const request = z
        .object({
          data: z.strictObject({
            requestId: z.uuid(),
            fingerprint: browserVaultPairing.shape.challenge,
            expiresAt: z.iso.datetime(),
          }),
        })
        .parse(result).data;

      this.assertCurrent(context);
      if (
        request.requestId !== value.pairing.requestId ||
        request.fingerprint !== fingerprint ||
        request.expiresAt !== value.pairing.expiresAt
      )
        throw new Error('vault_enrollment_mismatch');
      this.currentRequest.set(request);
      this.timer = context.browser.setTimeout(
        () => this.cancel(),
        Math.max(0, DateTime.fromISO(request.expiresAt).toMillis() - DateTime.utc().toMillis()),
      );
    } catch (error) {
      if (context.epoch === this.epoch) this.cancel();
      throw error;
    }
  }

  async inspect(requestId: string, code: string): Promise<BrowserRecipient> {
    const context = this.context();
    const id = z.uuid().parse(requestId.trim());
    const fingerprint = browserVaultPairing.shape.challenge.parse(code.trim());
    const result = await firstValueFrom(
      this.http
        .get<unknown>(`${this.base(context.owner.accountId)}/${id}`, { transferCache: false })
        .pipe(takeUntil(this.cancelled), timeout(10_000)),
    );
    const value = z
      .object({
        data: z.strictObject({
          pairing: browserVaultPairing,
          fingerprint: browserVaultPairing.shape.challenge,
          approved: z.boolean(),
        }),
      })
      .parse(result).data;

    this.assertCurrent(context);
    const valid = await verifyBrowserVaultPairing(context.crypto, value.pairing);
    const actual = await browserVaultFingerprint(context.crypto, value.pairing);

    this.assertCurrent(context);
    if (
      !valid ||
      value.approved ||
      value.pairing.requestId !== id ||
      value.pairing.ownerUserId !== context.owner.id ||
      value.pairing.personalScopeId !== context.owner.accountId ||
      actual !== fingerprint ||
      actual !== value.fingerprint ||
      DateTime.fromISO(value.pairing.expiresAt).toMillis() <= DateTime.utc().toMillis()
    )
      throw new Error('vault_enrollment_mismatch');

    return { pairing: value.pairing, fingerprint: actual };
  }

  async approve(recipient: BrowserRecipient, grantId: string): Promise<void> {
    const context = this.context();
    const release = this.vault.onLock(() => this.cancel());

    try {
      const valid = await verifyBrowserVaultPairing(context.crypto, recipient.pairing);
      const fingerprint = await browserVaultFingerprint(context.crypto, recipient.pairing);

      this.assertCurrent(context);
      if (
        !valid ||
        fingerprint !== recipient.fingerprint ||
        recipient.pairing.ownerUserId !== context.owner.id ||
        recipient.pairing.personalScopeId !== context.owner.accountId
      )
        throw new Error('vault_enrollment_mismatch');
      const envelope = await this.vault.deliverToBrowser(this.binding(recipient));

      this.assertCurrent(context);
      await firstValueFrom(
        this.http
          .post(`${this.base(context.owner.accountId)}/${recipient.pairing.requestId}/approve`, {
            fingerprint,
            envelope,
            grantId,
          })
          .pipe(takeUntil(this.cancelled), timeout(10_000)),
      );
      this.assertCurrent(context);
    } finally {
      release();
    }
  }

  async receive(): Promise<void> {
    const context = this.context();
    const pairing = this.pairing;
    const identity = this.recipient;
    const request = this.request();

    if (!pairing || !identity || !request) throw new Error('vault_enrollment_unavailable');
    const proof = await signBrowserVaultConsume(context.crypto, identity.signing.privateKey, pairing, {
      nonce: context.crypto.randomUUID(),
      issuedAt: DateTime.utc().toISO(),
    });

    this.assertCurrent(context);
    const result = await firstValueFrom(
      this.http
        .post<unknown>(`${this.base(context.owner.accountId)}/${pairing.requestId}/consume`, proof)
        .pipe(takeUntil(this.cancelled), timeout(10_000)),
    );
    const envelope = z.object({ data: browserVaultDelivery }).parse(result).data;

    this.assertCurrent(context);
    // Installing custody advances generation itself. The completed relay no longer owns a lock callback.
    this.releaseLock?.();
    this.releaseLock = undefined;
    this.receiving = true;
    try {
      await this.vault.unlockBrowserDelivery(
        this.binding({ pairing, fingerprint: request.fingerprint }),
        identity.encryption.privateKey,
        envelope,
        context.generation,
      );
      if (this.destroyRef.destroyed || context.identity !== this.identity() || context.epoch !== this.epoch) {
        this.vault.lock();
        throw new Error('vault_locked');
      }
      this.discard();
    } catch (error) {
      if (context.epoch === this.epoch) this.discard();
      throw error;
    } finally {
      this.receiving = false;
    }
  }

  private discard(): void {
    this.epoch++;
    this.releaseLock?.();
    this.releaseLock = undefined;
    if (this.timer !== undefined) this.document.defaultView?.clearTimeout(this.timer);
    this.timer = undefined;
    this.recipient = undefined;
    this.pairing = undefined;
    this.currentRequest.set(null);
    this.cancelled.next();
  }

  private context() {
    const owner = this.auth.user();
    const browser = this.document.defaultView;
    const identity = this.identity();

    if (!owner || !browser || !identity || this.destroyRef.destroyed) throw new Error('vault_locked');

    return { owner, browser, crypto: browser.crypto, identity, epoch: this.epoch, generation: this.vault.generation() };
  }

  private assertCurrent(context: ReturnType<BrowserUnlock['context']>): void {
    if (
      this.destroyRef.destroyed ||
      context.epoch !== this.epoch ||
      context.identity !== this.identity() ||
      context.generation !== this.vault.generation()
    )
      throw new Error('vault_locked');
  }

  private binding(recipient: BrowserRecipient): BrowserVaultBinding {
    return {
      ownerUserId: recipient.pairing.ownerUserId,
      personalScopeId: recipient.pairing.personalScopeId,
      requestId: recipient.pairing.requestId,
      challenge: recipient.pairing.challenge,
      fingerprint: recipient.fingerprint,
      recipientEncryption: recipient.pairing.keys.encryption,
      keyGeneration: 1,
    };
  }

  private base(scopeId: string): string {
    return `/api/vault-unlock/${scopeId}/browser-enrollments`;
  }

  private readonly cancelDepartingOwner = effect((cleanup) => {
    this.identity();
    cleanup(() => this.cancel());
  });
}
