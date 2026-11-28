import { DOCUMENT, Location } from '@angular/common';
import { DestroyRef, Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import {
  VaultError,
  deviceChallengeSchema,
  deviceProofSchema,
  keyDomainId,
  type DeviceProof,
  type WrappingContext,
} from '@visomi-stack/shared-db';
import { WebCryptoDevices, isVaultPin } from '@visomi-stack/web-frontend-db';

import { AuthHttp } from '../auth/shared/http';
import { Session } from '../auth/session/session';
import { BrowserRealtimeSession } from '../auth/session/browser-realtime-session';
import { ClientDatabase } from '../shared/db/database';
import { DatabaseHttp } from '../shared/db/http';
import { UnlockCapabilities } from '../shared/vault/unlock-capabilities';
import { VaultSession } from '../shared/vault/vault-session';
import { vaultMessage } from '../shared/vault/vault-messages';

import { ExamplePairingEnrollment } from './example-pairing-enrollment';
import { ExamplePairingDraft, openPairingDevice } from './example-pairing-draft';
import { ApproverPairingCode } from './example-pairing-code';
import { ExamplePairingExchange } from './example-pairing-exchange';
import { readRecovery } from './example-vault-recovery';
import { examplePrivatePath, type ExampleTarget } from './example-contracts';

type PendingPairing = {
  context: WrappingContext;
  custody?: Awaited<ReturnType<VaultSession['device']>>;
  proof: DeviceProof;
  fingerprint: string;
  token: string;
  reviewLink?: string;
};

@Service({ autoProvided: false })
export class ExampleVaultPairing {
  private readonly auth = inject(AuthHttp);
  private readonly api = inject(DatabaseHttp);
  private readonly database = inject(ClientDatabase);
  private readonly session = inject(Session);
  private readonly vault = inject(VaultSession);
  private readonly view = inject(DOCUMENT).defaultView!;
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly realtime = inject(BrowserRealtimeSession, { optional: true });

  private readonly lifetime = new AbortController();
  private readonly exchange = new ExamplePairingExchange(
    this.view,
    (proof, signal, message) =>
      this.api.vault(`${this.path()}/devices/pairing/${proof.requestId}/code`, message, signal),
    () => !!this.realtime?.connected(),
    (error) => this.drafts.retired(error),
  );

  readonly pending = signal<PendingPairing | null>(null);

  private readonly cleanup = inject(DestroyRef).onDestroy(() => {
    this.lifetime.abort();
    this.exchange.clearRecipient();
    const pending = this.pending();

    if (pending) {
      this.vault.lockContext(pending.context);
    }
  });

  private reviewSignal?: AbortSignal;
  private drafts!: ExamplePairingDraft;
  private enrollment!: ExamplePairingEnrollment;
  private target!: ExampleTarget;
  private rpId!: string;
  private backed = false;

  readonly capabilities = inject(UnlockCapabilities);

  readonly busy = signal(false);
  readonly message = signal('');
  readonly existing = signal<WrappingContext | null>(null);
  readonly pinSelected = signal(false);
  readonly recoveryFile = signal<File | null>(null);
  readonly ready = signal(false);
  readonly paired = signal(false);
  readonly approverFingerprint = signal('');
  readonly reviewProof = signal<DeviceProof | null>(null);
  readonly reviewUnavailable = signal(false);
  readonly pin = signal('');
  readonly confirmPin = signal('');

  readonly approverReady = computed(() => {
    const existing = this.existing();

    return !!existing && this.vault.canResume(existing);
  });
  readonly approval = computed(() => this.exchange.approval());
  readonly code = computed(() => this.exchange.code());

  async initialize(target: ExampleTarget, rpId: string, backed: boolean): Promise<void> {
    this.target = target;
    this.drafts = new ExamplePairingDraft(target, this.view, this.router, this.location, this.api);
    this.rpId = rpId;
    this.backed = backed;
    this.enrollment = new ExamplePairingEnrollment({
      api: this.api,
      database: this.database,
      vault: this.vault,
      crypto: this.view.crypto,
      rpId,
      path: this.path(),
      backed,
      target,
    });

    await this.run(async (signal, ownerId) => {
      const registry = await this.enrollment.roster(ownerId, signal);
      const existing = await this.enrollment.registeredBinding(registry);

      signal.throwIfAborted();
      this.existing.set(existing ?? null);

      if (this.backed && !existing) {
        const pending = await this.drafts.resume(ownerId, registry.key, signal);

        signal.throwIfAborted();

        if (pending) {
          this.exchange.resume(pending.authenticatedSigner);
        }

        this.pending.set(pending);
      }

      this.ready.set(true);

      if (backed || !existing || !this.vault.canResume(existing)) {
        return;
      }

      const custody = await this.vault.device(existing, this.rpId);
      const keys = await custody.publicKeys();
      const fingerprint = await this.enrollment.signerFingerprint({
        deviceId: existing.deviceId,
        signing: keys.signing,
      });

      signal.throwIfAborted();
      this.approverFingerprint.set(fingerprint);
    });
  }

  async loadReview(requestId: string | undefined, signal: AbortSignal): Promise<void> {
    this.reviewSignal = signal;
    this.reviewProof.set(null);
    this.reviewUnavailable.set(false);

    if (!requestId) {
      return;
    }

    try {
      const raw = await this.api.vault(`${this.path()}/devices/pairing/${requestId}`, undefined, signal);
      const proof = deviceProofSchema.parse(raw);
      const verified = await new WebCryptoDevices(this.view.crypto).verify(proof);

      if (proof.requestId !== requestId || this.exchange.attempted(requestId) || !verified) {
        throw new VaultError('corrupt');
      }

      signal.throwIfAborted();
      this.reviewProof.set(proof);
    } catch {
      if (!signal.aborted) {
        this.reviewUnavailable.set(true);
      }
    }
  }

  async request(usePin = false, createNew = false): Promise<void> {
    const supplied = this.takePin(usePin, true);

    if (usePin && !supplied?.length) {
      return;
    }

    try {
      await this.run(async (signal, ownerId) => {
        if (this.pending() || this.existing()) {
          throw new VaultError('unavailable');
        }

        const registry = await this.enrollment.roster(ownerId, signal);
        const existing = await this.enrollment.registeredBinding(registry);

        if (existing) {
          throw new VaultError('revision-conflict');
        }

        const recovery = this.recoveryFile();
        const authority = await (recovery
          ? readRecovery(recovery, registry.key, ownerId, this.view.location.origin)
          : undefined);
        const draft = this.backed ? this.drafts.readDraft(ownerId, registry.key) : undefined;
        const { context, custody } = await openPairingDevice({
          auth: this.auth,
          view: this.view,
          rpId: this.rpId,
          vault: this.vault,
          drafts: this.drafts,
          backed: this.backed,
          ownerId,
          key: registry.key,
          draft,
          usePin,
          createNew,
          supplied,
          signal,
        });
        const keys = await custody.publicKeys();
        const enrolled = registry.devices.some(
          (device) => device.id === context.deviceId && device.ownerId === ownerId && !device.revokedAt,
        );
        let proof = draft?.context.deviceId === context.deviceId ? draft.proof : undefined;

        if (!proof || (this.backed && !authority) || (!enrolled && Date.parse(proof.expiresAt) <= Date.now())) {
          const raw = await this.api.vault(
            this.path() + '/devices/request',
            { deviceId: context.deviceId, keys },
            signal,
          );
          const challenge = deviceChallengeSchema.parse(raw);

          if (
            keyDomainId(ownerId, challenge.key) !== keyDomainId(ownerId, registry.key) ||
            (this.backed && (challenge.ownerId !== ownerId || challenge.deviceId !== context.deviceId))
          ) {
            throw new VaultError('corrupt');
          }

          const signed = await custody.prove(challenge);

          proof = signed;
        }

        const fingerprint = await new WebCryptoDevices(this.view.crypto).fingerprint(proof);

        if (authority) {
          this.drafts.save(context, { proof, recovering: true });

          const signer = await this.enrollment.recover(authority, proof, registry.epoch, enrolled, signal, () =>
            this.drafts.save(context),
          );

          await this.enrollment.install(context, proof, fingerprint, signer, signal, { pin: supplied });

          this.completed(ownerId);

          return;
        }

        signal.throwIfAborted();
        this.exchange.approval.set('waiting');
        const pending = { context, custody, proof, fingerprint, token: JSON.stringify(proof) };

        if (this.backed) {
          this.drafts.save(context, { proof });

          try {
            await this.drafts.publish(context, proof, signal);

            await this.exchange.startRecipient(proof, signal, supplied);
          } catch {
            this.exchange.expireRecipient();
          }

          signal.throwIfAborted();
          this.pending.set({ ...pending, reviewLink: this.drafts.reviewLink(proof) });
        } else {
          this.pending.set(pending);
        }
      }, true);
    } finally {
      supplied?.fill(0);
    }
  }

  hasDedicatedPasskey(): boolean {
    return this.drafts.dedicated();
  }

  async copyReviewLink(link: string): Promise<void> {
    try {
      await this.view.navigator.clipboard.writeText(link);

      this.message.set($localize`:@@vaultPairingLinkCopied:Review link copied.`);
    } catch {
      this.message.set($localize`:@@vaultPairingLinkCopyFailed:Select and copy the review link below.`);
    }
  }

  resetExpired(): void {
    const pending = this.pending();

    if (pending && this.approval() === 'expired') {
      this.exchange.clearRecipient();
      this.exchange.authenticatedSigner = undefined;
      this.vault.lockContext(pending.context);

      if (this.backed) {
        this.drafts.save(pending.context);
      }

      this.pending.set(null);
      this.exchange.approval.set('waiting');
    }
  }

  cancelRequest(): void {
    this.exchange.expireRecipient();
  }

  approveReview(value: string): Promise<void> {
    const proof = this.reviewProof();
    const reviewSignal = this.reviewSignal;
    const code = value.replace(/ /g, '');

    if (!this.backed || !proof || !reviewSignal || this.busy() || !/^[0-9]{8}$/.test(code)) {
      return Promise.resolve();
    }

    const attempt = new ApproverPairingCode(code);

    return this.run(async (signal, ownerId) => {
      const deadline = AbortSignal.timeout(Math.min(300_000, Math.max(0, Date.parse(proof.expiresAt) - Date.now())));
      const active = AbortSignal.any([signal, reviewSignal, deadline]);
      const clear = () => attempt.clear();

      active.addEventListener('abort', clear, { once: true });

      try {
        await this.approveProof(proof, ownerId, active, attempt);
      } catch {
        if (!signal.aborted && !reviewSignal.aborted) {
          this.reviewProof.set(null);
          this.reviewUnavailable.set(true);
        }
      } finally {
        active.removeEventListener('abort', clear);
        clear();
      }
    });
  }

  approve(token: string, verifiedFingerprint: string): Promise<void> {
    if (this.backed) {
      return Promise.resolve();
    }

    return this.run(async (signal, ownerId) => {
      if (token.length > 4096) {
        throw new VaultError('locked');
      }

      await this.approveProof(deviceProofSchema.parse(JSON.parse(token)), ownerId, signal, verifiedFingerprint);
    });
  }

  async finish(verifiedFingerprint: string): Promise<void> {
    const pending = this.pending();

    if (this.backed || !pending) {
      return;
    }

    const usePin = pending.context.method === 'pin-argon2id';
    const pin = this.takePin(usePin);

    if (usePin && !pin?.length) {
      return;
    }

    try {
      await this.run(async (signal, ownerId) => {
        const approval = await this.enrollment.readManualApproval(
          pending.context,
          ownerId,
          signal,
          verifiedFingerprint,
        );

        if (!approval) {
          this.fingerprintMismatch();

          return;
        }

        if (pin) {
          pending.custody?.lock();
        }

        await this.enrollment.install(pending.context, pending.proof, pending.fingerprint, approval.signer, signal, {
          pin,
          approved: approval.delivery,
        });

        this.completed(ownerId);
      });
    } finally {
      pin?.fill(0);
    }
  }

  async finishBacked(): Promise<void> {
    const pending = this.pending();
    const signer = this.exchange.authenticatedSigner;

    if (!pending?.reviewLink || !signer || this.approval() !== 'approved' || this.busy()) {
      return;
    }

    const usePin = pending.context.method === 'pin-argon2id';
    const provisionedPin = this.exchange.takePin();
    const pin = provisionedPin ?? this.takePin(usePin);

    if (usePin && !pin?.length) {
      return;
    }

    try {
      await this.run(async (signal, ownerId) => {
        const clearPin = () => pin?.fill(0);

        signal.addEventListener('abort', clearPin, { once: true });

        try {
          await this.enrollment.install(pending.context, pending.proof, pending.fingerprint, signer, signal, {
            pin,
            verifyPin: !provisionedPin,
          });

          this.completed(ownerId);
        } finally {
          signal.removeEventListener('abort', clearPin);
        }
      });
    } finally {
      pin?.fill(0);
    }
  }

  private async approveProof(
    proof: DeviceProof,
    ownerId: string,
    signal: AbortSignal,
    verification: string | ApproverPairingCode,
  ): Promise<void> {
    const existing = this.existing();

    if (!existing) {
      throw new VaultError('locked');
    }

    const result = await this.enrollment.approve(
      proof,
      ownerId,
      signal,
      existing,
      typeof verification === 'string'
        ? verification
        : (signer) => this.exchange.authenticateRecipient(proof, signer, verification, signal),
      () => this.takePin(existing.method === 'pin-argon2id'),
    );

    if (result === 'mismatch') {
      this.fingerprintMismatch();
    } else if (result === 'approved') {
      this.reviewProof.set(null);
      this.message.set(
        this.backed
          ? $localize`:@@vaultPairingCodeApproved:Device approved. The new device can finish linking.`
          : $localize`:@@vaultDevicesApproved:Device approved. Finish on the other device.`,
      );
    }
  }

  private completed(ownerId: string): void {
    this.exchange.clearRecipient();
    this.exchange.authenticatedSigner = undefined;

    if (this.backed) {
      this.view.localStorage.removeItem(this.drafts.draftKey(ownerId));
    }

    this.pending.set(null);
    this.recoveryFile.set(null);
    this.paired.set(true);
    this.message.set($localize`:@@vaultDevicesPaired:Device paired. You can open the test private resource here.`);
  }

  private fingerprintMismatch(): void {
    this.message.set(
      $localize`:@@vaultDevicesFingerprintMismatch:The fingerprints don’t match. Check the fingerprint on the other device.`,
    );
  }

  private path(): string {
    return examplePrivatePath(this.target);
  }

  private takePin(usePin: boolean, confirm = false): Uint8Array | undefined {
    if (!usePin) {
      return undefined;
    }

    const value = this.pin();
    const confirmation = this.confirmPin();

    this.pin.set('');
    this.confirmPin.set('');
    const pin = new TextEncoder().encode(value);

    if (!isVaultPin(pin) || (confirm && value !== confirmation)) {
      pin.fill(0);
      this.message.set(vaultMessage('pin-invalid'));

      return new Uint8Array();
    }

    return pin;
  }

  private async run(action: (signal: AbortSignal, ownerId: string) => Promise<void>, probe = false): Promise<void> {
    const ownerId = this.session.user()?.id;

    if (this.busy() || !ownerId || !this.session.full()) {
      return;
    }

    const signals = [this.lifetime.signal, this.session.cancellation()];

    if (this.backed) {
      signals.push(this.vault.cancellation());
    }

    const signal = AbortSignal.any(signals);

    this.busy.set(true);
    this.message.set('');

    try {
      signal.throwIfAborted();

      await action(signal, ownerId);
    } catch (error) {
      if (!signal.aborted) {
        const code = error instanceof VaultError ? error.code : 'unavailable';

        if (probe && code === 'unsupported-prf') {
          this.capabilities.unavailable();
        }

        this.message.set(vaultMessage(code));
      }
    } finally {
      this.busy.set(false);
    }
  }

  private readonly pairingHints = effect(() => {
    this.realtime?.vaultPairingChanges();
    this.realtime?.connected();

    untracked(() => this.exchange.wake());
  });

  private readonly watchApproval = effect((cleanup) => {
    const pending = this.pending();

    if (!pending?.reviewLink || !this.session.full() || this.approval() !== 'waiting') {
      return;
    }

    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal, this.session.cancellation()]);
    const { proof, context } = pending;
    const stop = this.exchange.watchRecipient(
      proof,
      signal,
      (signer) =>
        this.drafts.save(context, {
          proof,
          published: true,
          verifiedPairing: signer && { requestId: proof.requestId, signer, verified: true },
        }),
      async () => {
        const roster = await this.enrollment.roster(proof.ownerId, signal);

        return roster.devices.some(({ id, revokedAt }) => id === context.deviceId && !revokedAt);
      },
      (auto) => {
        if (auto && (context.method !== 'pin-argon2id' || this.exchange.hasPin())) {
          void this.finishBacked();
        }
      },
    );

    cleanup(() => {
      stop();
      controller.abort();
    });
  });
}
