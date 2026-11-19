import { DOCUMENT } from '@angular/common';
import { DestroyRef, Service, inject, signal } from '@angular/core';
import {
  VaultError,
  approvedDeliverySchema,
  deviceChallengeSchema,
  deviceProofSchema,
  keyDomainId,
  signingPinSchema,
  type DeviceProof,
  type WrappingContext,
} from '@visomi-stack/shared-db';
import {
  WebCryptoDevices,
  createPinMethodId,
  createPrfCredential,
  encodeBytes,
  isVaultPin,
  replicaId,
} from '@visomi-stack/web-frontend-db';

import { Session } from '../auth/session/session';
import { ClientDatabase } from '../shared/db/database';
import { DatabaseHttp } from '../shared/db/http';
import { UnlockCapabilities } from '../shared/vault/unlock-capabilities';
import { VaultSession } from '../shared/vault/vault-session';
import { vaultMessage } from '../shared/vault/vault-messages';

import { exampleLocalKey, rosterSchema, type ExampleTarget } from './example-contracts';

@Service({ autoProvided: false })
export class ExampleVaultPairing {
  private readonly api = inject(DatabaseHttp);
  private readonly database = inject(ClientDatabase);
  private readonly session = inject(Session);
  private readonly vault = inject(VaultSession);
  private readonly view = inject(DOCUMENT).defaultView!;

  private readonly lifetime = new AbortController();

  readonly pending = signal<{
    context: WrappingContext;
    custody: Awaited<ReturnType<VaultSession['device']>>;
    proof: DeviceProof;
    fingerprint: string;
    token: string;
  } | null>(null);

  private readonly cleanup = inject(DestroyRef).onDestroy(() => {
    this.lifetime.abort();
    const pending = this.pending();

    if (pending) {
      this.vault.lockContext(pending.context);
    }
  });

  private target!: ExampleTarget;
  private rpId!: string;

  readonly capabilities = inject(UnlockCapabilities);

  readonly busy = signal(false);
  readonly message = signal('');
  readonly existing = signal<WrappingContext | null>(null);
  readonly ready = signal(false);
  readonly paired = signal(false);
  readonly approverFingerprint = signal('');
  readonly pin = signal('');
  readonly confirmPin = signal('');

  async initialize(target: ExampleTarget, rpId: string): Promise<void> {
    this.target = target;
    this.rpId = rpId;

    await this.run(async (signal, ownerId) => {
      const registry = await this.roster(ownerId, signal);
      const existing = await this.vault.localBinding(registry.key);

      signal.throwIfAborted();
      this.existing.set(existing ?? null);
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

  async request(usePin = false): Promise<void> {
    const supplied = this.takePin(usePin, true);

    if (usePin && !supplied?.length) {
      return;
    }

    try {
      await this.run(async (signal, ownerId) => {
        if (this.pending() || this.existing() || (usePin && this.capabilities.prf() !== 'unavailable')) {
          throw new VaultError('unavailable');
        }

        const registry = await this.roster(ownerId, signal);
        const existing = await this.vault.localBinding(registry.key);

        if (existing) {
          throw new VaultError('revision-conflict');
        }

        const methodId = await (usePin
          ? createPinMethodId(this.view.crypto)
          : createPrfCredential(
              {
                origin: this.view.location.origin,
                rpId: this.rpId,
                credentials: this.view.navigator.credentials,
                crypto: this.view.crypto,
              },
              signal,
            ));
        const context: WrappingContext = {
          key: registry.key,
          ownerId,
          deviceId: this.view.crypto.randomUUID(),
          method: usePin ? 'pin-argon2id' : 'passkey-prf',
          methodId,
          origin: this.view.location.origin,
        };

        signal.throwIfAborted();

        const custody = await this.vault.device(context, this.rpId, true, supplied);
        const keys = await custody.publicKeys();
        const raw = await this.api.request(
          `${this.path()}/devices/request`,
          { deviceId: context.deviceId, keys },
          signal,
        );
        const proof = await custody.prove(deviceChallengeSchema.parse(raw));
        const fingerprint = await new WebCryptoDevices(this.view.crypto).fingerprint(proof);

        signal.throwIfAborted();
        this.pending.set({ context, custody, proof, fingerprint, token: JSON.stringify(proof) });
      }, true);
    } finally {
      supplied?.fill(0);
    }
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
      const delivery = await this.vault.deliver(existing, this.deliveryBinding(proof, fingerprint));
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

      await this.api.request(`${this.path()}/devices/approve`, { ...body, authorization }, signal);

      this.message.set($localize`:@@vaultDevicesApproved:Device approved. Finish on the other device.`);
    });
  }

  async finish(verifiedFingerprint: string): Promise<void> {
    const pending = this.pending();

    if (!pending) {
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
        const raw = await this.api.request(
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

        if (delivery.witness.kind !== 'enrollment' || delivery.witness.history) {
          throw new VaultError('corrupt');
        }

        signal.throwIfAborted();

        if (pin) {
          pending.custody.lock();
        }

        const custody = await this.vault.device(pending.context, this.rpId, false, pin);

        signal.throwIfAborted();

        const key = await custody.open(this.deliveryBinding(pending.proof, pending.fingerprint), delivery, signer);

        try {
          signal.throwIfAborted();

          const storage = await this.database.replica(ownerId, signal);

          try {
            const id = replicaId(ownerId, registry.key, registry.key.scope);

            await storage.advanceControl(id, {
              generation: registry.key.generation,
              epoch: delivery.authorization.epoch + 1,
            });
          } finally {
            storage.close();
          }

          signal.throwIfAborted();

          const installed = await this.vault.localBinding(registry.key);

          signal.throwIfAborted();

          if (!custody.ready || installed) {
            throw new VaultError('locked');
          }

          await this.vault.install(pending.context, this.rpId, key, pin);
        } finally {
          key.fill(0);
        }

        signal.throwIfAborted();
        this.pending.set(null);
        this.paired.set(true);
        this.message.set($localize`:@@vaultDevicesPaired:Device paired. You can open the test private resource here.`);
      });
    } finally {
      pin?.fill(0);
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
    const raw = await this.api.request(`${this.path()}/devices`, undefined, signal);
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
}
