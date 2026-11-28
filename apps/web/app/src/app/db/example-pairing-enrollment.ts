import { HttpErrorResponse } from '@angular/common/http';
import {
  VaultError,
  approvedDeliverySchema,
  signingPinSchema,
  keyDomainId,
  type DeviceProof,
  type SigningPin,
  type WrappingContext,
} from '@visomi-stack/shared-db';
import { WebCryptoDevices, encodeBytes } from '@visomi-stack/web-frontend-db';

import type { ClientDatabase } from '../shared/db/database';
import type { DatabaseHttp } from '../shared/db/http';
import type { VaultSession } from '../shared/vault/vault-session';

import { exampleLocalKey, rosterSchema, type ExampleTarget } from './example-contracts';
import { installApprovedKey } from './example-vault-enrollment';
import { approvalAction, deliveryRecipient, recoverApproval, type readRecovery } from './example-vault-recovery';

export class ExamplePairingEnrollment {
  constructor(
    private readonly options: {
      api: DatabaseHttp;
      database: ClientDatabase;
      vault: VaultSession;
      crypto: Crypto;
      rpId: string;
      path: string;
      backed: boolean;
      target: ExampleTarget;
    },
  ) {}

  async readDelivery(deviceId: string, signal: AbortSignal) {
    const raw = await this.options.api.vault(`${this.options.path}/devices/${deviceId}/delivery`, undefined, signal);

    return approvedDeliverySchema.parse(raw);
  }

  async approve(
    proof: DeviceProof,
    ownerId: string,
    signal: AbortSignal,
    existing: WrappingContext,
    verification: string | ((signer: SigningPin) => Promise<void>),
    takePin: () => Uint8Array | undefined,
  ): Promise<'approved' | 'mismatch' | undefined> {
    const { api, crypto, vault, rpId, path } = this.options;

    signal.throwIfAborted();

    if (!vault.canResume(existing)) {
      throw new VaultError('locked');
    }

    const registry = await this.roster(ownerId, signal);
    const fingerprint = await new WebCryptoDevices(crypto).fingerprint(proof);

    if (typeof verification === 'string' && fingerprint !== verification.trim()) {
      return 'mismatch';
    }

    if (
      proof.ownerId !== ownerId ||
      proof.deviceId === existing.deviceId ||
      Date.parse(proof.expiresAt) <= Date.now() ||
      keyDomainId(ownerId, proof.key) !== keyDomainId(ownerId, registry.key) ||
      !vault.resume(existing)
    ) {
      throw new VaultError('corrupt');
    }

    const custody = await vault.device(existing, rpId);
    const pin = takePin();

    if (pin && !pin.length) {
      return;
    }

    try {
      if (typeof verification !== 'string') {
        const { signing } = await custody.publicKeys();

        await verification({ deviceId: existing.deviceId, signing });
      }

      signal.throwIfAborted();

      const delivery = await vault.deliver(existing, deliveryRecipient(proof, fingerprint), pin);
      const body = { proof, delivery };
      const action = await approvalAction(crypto, registry.key, existing.deviceId, registry.epoch, body);
      const authorization = await custody.sign(action);

      signal.throwIfAborted();

      if (!vault.canResume(existing)) {
        throw new VaultError('locked');
      }

      await api.vault(`${path}/devices/approve`, { ...body, authorization }, signal);

      return 'approved';
    } finally {
      pin?.fill(0);
    }
  }

  async install(
    context: WrappingContext,
    proof: DeviceProof,
    fingerprint: string,
    signer: SigningPin,
    signal: AbortSignal,
    options: {
      pin?: Uint8Array;
      approved?: ReturnType<typeof approvedDeliverySchema.parse>;
      verifyPin?: boolean;
      registry?: ReturnType<typeof rosterSchema.parse>;
    },
  ) {
    const { database, vault, rpId, backed } = this.options;
    const { pin, approved, verifyPin, registry } = options;
    const delivery = await (approved ?? this.readDelivery(context.deviceId, signal));

    if (delivery.witness.kind !== 'enrollment' || delivery.witness.history) {
      throw new VaultError('corrupt');
    }

    const custody = await vault.device(context, rpId, verifyPin && pin ? 'resume' : false, pin);
    const key = await custody.open(deliveryRecipient(proof, fingerprint), delivery, signer);

    try {
      signal.throwIfAborted();

      await installApprovedKey({
        database,
        vault,
        context,
        signal,
        backed,
        roster: async () => registry ?? this.roster(context.ownerId, signal),
        install: () => {
          if (!custody.ready) {
            throw new VaultError('locked');
          }

          return vault.install(context, rpId, key, pin);
        },
        epoch: delivery.authorization.epoch + 1,
      });
    } finally {
      key.fill(0);
    }
  }

  recover(
    authority: Awaited<ReturnType<typeof readRecovery>>,
    proof: DeviceProof,
    epoch: number,
    enrolled: boolean,
    signal: AbortSignal,
    reset: () => void,
  ) {
    const { api, path } = this.options;

    return recoverApproval(api, path, authority, proof, epoch, enrolled, signal).catch((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        ['device_state_conflict', 'device_challenge_invalid'].includes(error.error?.error)
      ) {
        reset();
      }

      throw error;
    });
  }

  async readManualApproval(context: WrappingContext, ownerId: string, signal: AbortSignal, expected: string) {
    const registry = await this.roster(ownerId, signal);
    const delivery = await this.readDelivery(context.deviceId, signal);
    const candidate = registry.devices.find(
      ({ id, revokedAt }) => id === delivery.authorization.deviceId && !revokedAt,
    );
    const signer = signingPinSchema.parse({ deviceId: candidate?.id, signing: candidate?.signing });
    const fingerprint = await this.signerFingerprint(signer);

    return fingerprint === expected.trim() ? { delivery, signer } : undefined;
  }

  async signerFingerprint(signer: SigningPin): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(signer));
    const digest = await this.options.crypto.subtle.digest('SHA-256', bytes);

    return encodeBytes(new Uint8Array(digest));
  }

  async roster(ownerId: string, signal: AbortSignal) {
    const raw = await this.options.api.vault(`${this.options.path}/devices`, undefined, signal);
    const registry = rosterSchema.parse(raw);
    const expected = { ...exampleLocalKey(this.options.target), generation: 1 };

    if (
      Boolean(registry.objectBackup) !== this.options.backed ||
      registry.phase !== 'ready' ||
      keyDomainId(ownerId, registry.key) !== keyDomainId(ownerId, expected)
    ) {
      throw new VaultError('recovery-required');
    }

    return registry;
  }

  async registeredBinding(registry: ReturnType<typeof rosterSchema.parse>) {
    const local = await this.options.vault.localBinding(registry.key);

    if (!local || !this.options.backed) {
      return local;
    }

    const device = registry.devices.find(({ id }) => id === local.deviceId);

    if (device && (device.revokedAt || device.ownerId !== local.ownerId)) {
      throw new VaultError('recovery-required');
    }

    return device ? local : undefined;
  }
}
