import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Injectable } from '@angular/core';
import { firstValueFrom, Subject, takeUntil, timeout } from 'rxjs';
import { z } from 'zod';

import { Auth } from '../shared/auth/auth';
import { Passkey, serializeCredential } from '../shared/auth/passkey';

import { evaluateVaultPrf } from './passkey-unlock';
import { VaultSession } from './vault-session';

import { derivePrfWrappingKey, encodeVaultBytes, openVaultKey, prfKeyEnvelope } from 'shared-crypto';

const method = z.strictObject({
  methodId: z.uuid(),
  credentialId: z.string(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
const begin = z.strictObject({
  challengeId: z.uuid(),
  methodId: z.uuid(),
  credentialId: z.string(),
  prfInput: z.string(),
  options: z.record(z.string(), z.unknown()),
  expiresAt: z.iso.datetime(),
});

export type UnlockMethod = z.infer<typeof method>;

/** Route-owned ceremonies never survive a custody generation, owner change or destroyed view. */
@Injectable()
export class PrfUnlock {
  private readonly document = inject(DOCUMENT);
  private readonly http = inject(HttpClient);
  private readonly auth = inject(Auth);
  private readonly passkey = inject(Passkey);
  private readonly vault = inject(VaultSession);

  private readonly identity = computed(() => {
    const owner = this.auth.user();

    return this.auth.isAuthenticated() && owner
      ? JSON.stringify([owner.id, owner.accountId, owner.authVersion ?? 1])
      : null;
  });

  private readonly cancelled = new Subject<void>();

  private controller: AbortController | undefined;

  cancel(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.cancelled.next();
  }

  async methods(): Promise<UnlockMethod[]> {
    const owner = this.auth.user();
    const identity = this.identity();

    if (!owner || !identity) throw new Error('vault_locked');
    const result = await firstValueFrom(
      this.http
        .get<unknown>(`/api/vault-unlock/${owner.accountId}/methods`, { transferCache: false })
        .pipe(takeUntil(this.cancelled), timeout(10_000)),
    );

    if (identity !== this.identity()) throw new Error('vault_locked');

    return z.object({ data: z.array(method).max(20) }).parse(result).data;
  }

  async enroll(credentialId: string, grantId: string): Promise<void> {
    const context = this.start();
    const borrower = { lock: () => this.cancel() };

    this.vault.borrow(borrower);
    const release = this.vault.onLock(() => this.cancel());

    try {
      const begun = await this.begin(context.owner.accountId, { purpose: 'enroll', credentialId });

      this.assertCurrent(context);
      if (begun.credentialId !== credentialId) throw new Error('vault_passkey_mismatch');
      const evaluation = await evaluateVaultPrf(
        this.passkey,
        begun.options,
        begun.credentialId,
        begun.prfInput,
        context.controller.signal,
      );

      try {
        this.assertCurrent(context);
        const result = await this.complete(context.owner.accountId, begun.challengeId, evaluation.credential);
        const proof = z
          .object({ data: z.strictObject({ purpose: z.literal('enroll'), enrollmentProofId: z.uuid() }) })
          .parse(result).data;

        this.assertCurrent(context);
        const metadata = {
          version: 1 as const,
          kdfProfile: 'prf-hkdf-sha256-v1' as const,
          prfInput: begun.prfInput,
          hkdfSalt: encodeVaultBytes(context.crypto.getRandomValues(new Uint8Array(32))),
          binding: {
            ownerUserId: context.owner.id,
            personalScopeId: context.owner.accountId,
            methodId: begun.methodId,
            methodKind: 'passkey-prf' as const,
            credentialId: begun.credentialId,
            keyGeneration: 1 as const,
          },
        };
        const key = await derivePrfWrappingKey(context.crypto, evaluation.output, metadata.binding, metadata.hkdfSalt);

        this.assertCurrent(context);
        const envelope = prfKeyEnvelope.parse(await this.vault.wrap(key, metadata));
        const roundTrip = await openVaultKey(context.crypto, key, envelope, metadata.binding);

        roundTrip.fill(0);
        this.assertCurrent(context);
        await firstValueFrom(
          this.http
            .post(`/api/vault-unlock/${context.owner.accountId}/methods`, {
              methodId: begun.methodId,
              credentialId,
              envelope,
              enrollmentProofId: proof.enrollmentProofId,
              grantId,
            })
            .pipe(takeUntil(this.cancelled), timeout(10_000)),
        );
        this.assertCurrent(context);
      } finally {
        evaluation.output.fill(0);
      }
    } finally {
      release();
      this.vault.release(borrower);
      if (this.controller === context.controller) this.controller = undefined;
    }
  }

  async unlock(methodId: string): Promise<void> {
    const context = this.start();
    const release = this.vault.onLock(() => this.cancel());

    try {
      const begun = await this.begin(context.owner.accountId, { purpose: 'unlock', methodId });

      this.assertCurrent(context);
      if (begun.methodId !== methodId) throw new Error('vault_passkey_mismatch');
      const evaluation = await evaluateVaultPrf(
        this.passkey,
        begun.options,
        begun.credentialId,
        begun.prfInput,
        context.controller.signal,
      );

      try {
        this.assertCurrent(context);
        const result = await this.complete(context.owner.accountId, begun.challengeId, evaluation.credential);
        const envelope = z
          .object({ data: z.strictObject({ purpose: z.literal('unlock'), envelope: prfKeyEnvelope }) })
          .parse(result).data.envelope;

        this.assertCurrent(context);
        if (
          envelope.prfInput !== begun.prfInput ||
          envelope.binding.credentialId !== begun.credentialId ||
          envelope.binding.methodId !== methodId ||
          envelope.binding.ownerUserId !== context.owner.id ||
          envelope.binding.personalScopeId !== context.owner.accountId
        )
          throw new Error('vault_passkey_mismatch');
        const key = await derivePrfWrappingKey(context.crypto, evaluation.output, envelope.binding, envelope.hkdfSalt);

        this.assertCurrent(context);
        // Installation advances custody generation itself; stop cancelling this completed ceremony first.
        release();
        await this.vault.unlockEnvelope(envelope, key, context.generation);
      } finally {
        evaluation.output.fill(0);
      }
    } finally {
      release();
      if (this.controller === context.controller) this.controller = undefined;
    }
  }

  async revoke(value: UnlockMethod, grantId: string): Promise<void> {
    const context = this.start();

    try {
      await firstValueFrom(
        this.http
          .delete(`/api/vault-unlock/${context.owner.accountId}/methods/${value.methodId}`, {
            body: { expectedRevision: value.revision, grantId },
          })
          .pipe(takeUntil(this.cancelled), timeout(10_000)),
      );
      this.assertCurrent(context);
      this.vault.lock();
    } finally {
      if (this.controller === context.controller) this.controller = undefined;
    }
  }

  private start() {
    this.cancel();
    const owner = this.auth.user();
    const crypto = this.document.defaultView?.crypto;
    const identity = this.identity();

    if (!owner || !crypto || !identity) throw new Error('vault_locked');
    const controller = new AbortController();

    this.controller = controller;

    return { owner, crypto, identity, controller, generation: this.vault.generation() };
  }

  private assertCurrent(context: ReturnType<PrfUnlock['start']>): void {
    if (
      context.controller.signal.aborted ||
      context.controller !== this.controller ||
      context.identity !== this.identity() ||
      context.generation !== this.vault.generation()
    )
      throw new Error('vault_locked');
  }

  private async begin(
    scopeId: string,
    input: { purpose: 'enroll'; credentialId: string } | { purpose: 'unlock'; methodId: string },
  ) {
    const result = await firstValueFrom(
      this.http
        .post<unknown>(`/api/vault-unlock/${scopeId}/assertions/begin`, input)
        .pipe(takeUntil(this.cancelled), timeout(10_000)),
    );

    return z.object({ data: begin }).parse(result).data;
  }

  private complete(scopeId: string, challengeId: string, credential: Credential): Promise<unknown> {
    return firstValueFrom(
      this.http
        .post<unknown>(`/api/vault-unlock/${scopeId}/assertions/complete`, {
          challengeId,
          response: serializeCredential(credential),
        })
        .pipe(takeUntil(this.cancelled), timeout(10_000)),
    );
  }

  private readonly cancelDepartingIdentity = effect((cleanup) => {
    this.identity();
    cleanup(() => this.cancel());
  });
}
