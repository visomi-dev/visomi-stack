import { DOCUMENT, Location } from '@angular/common';
import { DestroyRef, Service, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  VaultError,
  approvedDeliverySchema,
  deviceChallengeSchema,
  type SigningPin,
  deviceProofSchema,
  keyDomainId,
  signingPinSchema,
  type DeviceProof,
  type WrappingContext,
} from '@visomi-stack/shared-db';
import { WebCryptoDevices, encodeBytes, isVaultPin, replicaId } from '@visomi-stack/web-frontend-db';

import { AuthHttp } from '../auth/shared/http';
import { Session } from '../auth/session/session';
import { BrowserRealtimeSession } from '../auth/session/browser-realtime-session';
import { ClientDatabase } from '../shared/db/database';
import { DatabaseHttp } from '../shared/db/http';
import { UnlockCapabilities } from '../shared/vault/unlock-capabilities';
import { VaultSession } from '../shared/vault/vault-session';
import { vaultMessage } from '../shared/vault/vault-messages';

import { ExamplePairingDraft, openPairingDevice } from './example-pairing-draft';
import { recoverApproval, readRecovery } from './example-vault-recovery';
import { exampleLocalKey, rosterSchema, type ExampleTarget } from './example-contracts';
import { watchVaultPairing } from './example-vault-pairing-watch';

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

  readonly pending = signal<{
    context: WrappingContext;
    custody?: Awaited<ReturnType<VaultSession['device']>>;
    proof: DeviceProof;
    fingerprint: string;
    token: string;
    reviewLink?: string;
  } | null>(null);

  private readonly cleanup = inject(DestroyRef).onDestroy(() => {
    this.lifetime.abort();
    const pending = this.pending();

    if (pending) {
      this.vault.lockContext(pending.context);
    }
  });

  private drafts!: ExamplePairingDraft;
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
  readonly approval = signal<'waiting' | 'approved' | 'expired'>('waiting');
  readonly pin = signal('');
  readonly confirmPin = signal('');

  async initialize(target: ExampleTarget, rpId: string, backed: boolean): Promise<void> {
    this.target = target;
    this.drafts = new ExamplePairingDraft(target, this.view, this.router, this.location, this.api);
    this.rpId = rpId;
    this.backed = backed;

    await this.run(async (signal, ownerId) => {
      const registry = await this.roster(ownerId, signal);
      const existing = await this.vault.localBinding(registry.key);

      signal.throwIfAborted();
      this.existing.set(existing ?? null);

      if (this.backed && !existing) {
        const draft = this.drafts.readDraft(ownerId, registry.key);

        if (draft?.proof && !draft.recovering) {
          if (
            !draft.published &&
            Date.parse(draft.proof.expiresAt) > Date.now() &&
            !registry.devices.some((device) => device.id === draft.context.deviceId)
          ) {
            await this.drafts.publish(draft.context, draft.proof, signal);
          }

          const fingerprint = await new WebCryptoDevices(this.view.crypto).fingerprint(draft.proof);

          signal.throwIfAborted();
          this.pending.set({
            context: draft.context,
            proof: draft.proof,
            fingerprint,
            token: JSON.stringify(draft.proof),
            reviewLink: this.drafts.reviewLink(draft.proof),
          });
        }
      }

      this.ready.set(true);

      if (!existing || !this.vault.canResume(existing)) {
        return;
      }

      const custody = await this.vault.device(existing, this.rpId);
      const keys = await custody.publicKeys();
      const fingerprint = await this.digest({ deviceId: existing.deviceId, signing: keys.signing });

      signal.throwIfAborted();
      this.approverFingerprint.set(fingerprint);
    });
  }

  async loadReview(requestId: string | undefined, signal: AbortSignal): Promise<void> {
    this.reviewProof.set(null);
    this.reviewUnavailable.set(false);

    if (!requestId) {
      return;
    }

    try {
      const raw = await this.api.vault(`${this.path()}/devices/pairing/${requestId}`, undefined, signal);
      const proof = deviceProofSchema.parse(raw);

      if (proof.requestId !== requestId) {
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

        const registry = await this.roster(ownerId, signal);
        const existing = await this.vault.localBinding(registry.key);

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

        if (!proof || (!enrolled && Date.parse(proof.expiresAt) <= Date.now())) {
          const raw = await this.api.vault(
            this.path() + '/devices/request',
            { deviceId: context.deviceId, keys },
            signal,
          );
          const challenge = deviceChallengeSchema.parse(raw);

          if (keyDomainId(ownerId, challenge.key) !== keyDomainId(ownerId, registry.key)) {
            throw new VaultError('corrupt');
          }

          const signed = await custody.prove(challenge);

          proof = signed;
        }

        const fingerprint = await new WebCryptoDevices(this.view.crypto).fingerprint(proof);
        let reviewLink: string | undefined;

        if (authority) {
          this.view.localStorage.setItem(
            this.drafts.draftKey(ownerId),
            JSON.stringify({ context, proof, recovering: true }),
          );

          const signer = await recoverApproval(
            this.api,
            this.path(),
            authority,
            proof,
            registry.epoch,
            enrolled,
            signal,
          );

          await this.installRecipient(context, proof, fingerprint, signer, signal, supplied);

          this.completed(ownerId);

          return;
        }

        if (this.backed) {
          // Persist only public request metadata; private identities stay in encrypted local custody.
          this.view.localStorage.setItem(this.drafts.draftKey(ownerId), JSON.stringify({ context, proof }));

          await this.drafts.publish(context, proof, signal);

          reviewLink = this.drafts.reviewLink(proof);
        }

        signal.throwIfAborted();
        this.approval.set('waiting');
        this.pending.set({ context, custody, proof, fingerprint, token: JSON.stringify(proof), reviewLink });
      }, true);
    } finally {
      supplied?.fill(0);
    }
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
      this.vault.lockContext(pending.context);

      if (this.backed) {
        this.view.localStorage.setItem(
          this.drafts.draftKey(pending.context.ownerId),
          JSON.stringify({ context: pending.context }),
        );
      }

      this.pending.set(null);
      this.approval.set('waiting');
    }
  }

  approveReview(fingerprint: string): Promise<void> {
    const proof = this.reviewProof();

    return proof ? this.approve(JSON.stringify(proof), fingerprint) : Promise.resolve();
  }

  approve(token: string, verifiedFingerprint: string): Promise<void> {
    return this.run(async (signal, ownerId) => {
      const existing = this.existing();

      if (!existing || !this.vault.canResume(existing) || token.length > 4096) {
        throw new VaultError('locked');
      }

      const registry = await this.roster(ownerId, signal);
      const proof = deviceProofSchema.parse(JSON.parse(token));
      const fingerprint = await new WebCryptoDevices(this.view.crypto).fingerprint(proof);

      if (this.backed && Date.parse(proof.expiresAt) <= Date.now()) {
        this.reviewProof.set(null);
        this.reviewUnavailable.set(true);

        return;
      }

      if (fingerprint !== verifiedFingerprint.trim()) {
        this.fingerprintMismatch();

        return;
      }

      if (
        proof.ownerId !== ownerId ||
        proof.deviceId === existing.deviceId ||
        Date.parse(proof.expiresAt) <= Date.now() ||
        keyDomainId(ownerId, proof.key) !== keyDomainId(ownerId, registry.key) ||
        !this.vault.resume(existing)
      ) {
        throw new VaultError('corrupt');
      }

      const custody = await this.vault.device(existing, this.rpId);
      const pin = this.takePin(existing.method === 'pin-argon2id');

      if (pin && !pin.length) {
        return;
      }

      const delivery = await this.vault
        .deliver(existing, this.deliveryBinding(proof, fingerprint), pin)
        .finally(() => pin?.fill(0));
      const body = { proof, delivery };
      const bodyHash = await this.digest(body);
      const authorization = await custody.sign({
        key: registry.key,
        action: 'approve',
        deviceId: existing.deviceId,
        epoch: registry.epoch,
        operationId: this.view.crypto.randomUUID(),
        bodyHash,
      });

      signal.throwIfAborted();

      if (!this.vault.canResume(existing)) {
        throw new VaultError('locked');
      }

      await this.api.vault(`${this.path()}/devices/approve`, { ...body, authorization }, signal);

      this.reviewProof.set(null);
      this.message.set($localize`:@@vaultDevicesApproved:Device approved. Finish on the other device.`);
    });
  }

  async finish(verifiedFingerprint: string): Promise<void> {
    const pending = this.pending();

    if (!pending || (pending.reviewLink && this.approval() !== 'approved')) {
      return;
    }

    const usePin = pending.context.method === 'pin-argon2id';
    const pin = this.takePin(usePin);

    if (usePin && !pin?.length) {
      return;
    }

    try {
      await this.run(async (signal, ownerId) => {
        const registry = await this.roster(ownerId, signal);
        const raw = await this.api.vault(
          `${this.path()}/devices/${pending.context.deviceId}/delivery`,
          undefined,
          signal,
        );
        const delivery = approvedDeliverySchema.parse(raw);
        const candidate = registry.devices.find(
          ({ id, revokedAt }) => id === delivery.authorization.deviceId && !revokedAt,
        );
        const signer = signingPinSchema.parse({ deviceId: candidate?.id, signing: candidate?.signing });
        const fingerprint = await this.digest(signer);

        if (fingerprint !== verifiedFingerprint.trim()) {
          this.fingerprintMismatch();

          return;
        }

        if (pin) {
          pending.custody?.lock();
        }

        await this.installRecipient(pending.context, pending.proof, pending.fingerprint, signer, signal, pin, delivery);

        this.completed(ownerId);
      });
    } finally {
      pin?.fill(0);
    }
  }

  private completed(ownerId: string): void {
    if (this.backed) {
      this.view.localStorage.removeItem(this.drafts.draftKey(ownerId));
    }

    this.pending.set(null);
    this.recoveryFile.set(null);
    this.paired.set(true);
    this.message.set($localize`:@@vaultDevicesPaired:Device paired. You can open the test private resource here.`);
  }

  private async installRecipient(
    context: WrappingContext,
    proof: DeviceProof,
    fingerprint: string,
    signer: SigningPin,
    signal: AbortSignal,
    pin?: Uint8Array,
    approved?: ReturnType<typeof approvedDeliverySchema.parse>,
  ) {
    let delivery = approved;

    if (!delivery) {
      const raw = await this.api.vault(this.path() + '/devices/' + context.deviceId + '/delivery', undefined, signal);

      delivery = approvedDeliverySchema.parse(raw);
    }

    if (delivery.witness.kind !== 'enrollment' || delivery.witness.history) {
      throw new VaultError('corrupt');
    }

    const custody = await this.vault.device(context, this.rpId, false, pin);
    const key = await custody.open(this.deliveryBinding(proof, fingerprint), delivery, signer);

    try {
      signal.throwIfAborted();

      const storage = await this.database.replica(context.ownerId, signal);

      try {
        await storage.advanceControl(replicaId(context.ownerId, context.key, context.key.scope), {
          generation: context.key.generation,
          epoch: delivery.authorization.epoch + 1,
        });
      } finally {
        storage.close();
      }
      const installed = await this.vault.localBinding(context.key);

      signal.throwIfAborted();

      if (!custody.ready || installed) {
        throw new VaultError('locked');
      }

      await this.vault.install(context, this.rpId, key, pin);
    } finally {
      key.fill(0);
    }
  }

  private fingerprintMismatch(): void {
    this.message.set(
      $localize`:@@vaultDevicesFingerprintMismatch:The fingerprints don’t match. Check the fingerprint on the other device.`,
    );
  }

  private path(): string {
    const { tenantId, scopeId } = this.target;

    return `/tenants/${tenantId}/scopes/${scopeId}/domains/private-resources`;
  }

  private async roster(ownerId: string, signal: AbortSignal) {
    const raw = await this.api.vault(`${this.path()}/devices`, undefined, signal);
    const registry = rosterSchema.parse(raw);
    const expected = { ...exampleLocalKey(this.target), generation: 1 };

    if (registry.phase !== 'ready' || keyDomainId(ownerId, registry.key) !== keyDomainId(ownerId, expected)) {
      throw new VaultError('recovery-required');
    }

    return registry;
  }

  private deliveryBinding(proof: DeviceProof, fingerprint: string) {
    return {
      key: proof.key,
      ownerId: proof.ownerId,
      deviceId: proof.deviceId,
      requestId: proof.requestId,
      challenge: proof.challenge,
      fingerprint,
      encryption: proof.keys.encryption,
    };
  }

  private async digest(value: unknown): Promise<string> {
    const bytes = await this.view.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));

    return encodeBytes(new Uint8Array(bytes));
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

    const signal = AbortSignal.any([this.lifetime.signal, this.session.cancellation()]);

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

  private readonly watchApproval = effect((cleanup) => {
    const pending = this.pending();
    const full = this.session.full();

    this.realtime?.vaultPairingChanges();
    this.realtime?.connected();

    if (!pending?.reviewLink || !full || this.approval() !== 'waiting') {
      return;
    }

    const controller = new AbortController();
    const stop = watchVaultPairing(
      this.view,
      async () => {
        try {
          const roster = await this.roster(pending.proof.ownerId, controller.signal);

          if (controller.signal.aborted) {
            return;
          }

          if (roster.devices.some(({ id, revokedAt }) => id === pending.context.deviceId && !revokedAt)) {
            this.approval.set('approved');
          } else if (Date.parse(pending.proof.expiresAt) <= Date.now()) {
            this.approval.set('expired');
          }
        } catch {
          // Retry the authenticated read on reconnect or the next poll.
        }
      },
      () => !!this.realtime?.connected(),
    );

    cleanup(() => {
      stop();
      controller.abort();
    });
  });
}
