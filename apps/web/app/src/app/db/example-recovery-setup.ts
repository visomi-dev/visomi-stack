import { signal } from '@angular/core';
import { VaultError, deviceChallengeSchema, type WrappingContext } from '@visomi-stack/shared-db';
import { isVaultPin, type DeviceCustody } from '@visomi-stack/web-frontend-db';

import type { DatabaseHttp } from '../shared/db/http';
import type { VaultSession } from '../shared/vault/vault-session';

import { rosterSchema } from './example-contracts';
import { prepareRecovery } from './example-vault-recovery';

export class ExampleRecoverySetup {
  private saved?: () => void;

  readonly recoveryDownload = signal('');
  readonly pin = signal('');
  readonly downloaded = signal(false);

  constructor(
    private readonly api: DatabaseHttp,
    private readonly vault: VaultSession,
  ) {}

  confirmRecovery(): void {
    if (this.downloaded()) {
      this.saved?.();
    }
  }

  async enroll(
    path: string,
    binding: WrappingContext,
    custody: DeviceCustody,
    signal: AbortSignal,
    method?: WrappingContext['method'],
  ) {
    const pin = method === 'pin-argon2id' ? new TextEncoder().encode(this.pin()) : undefined;

    this.pin.set('');

    try {
      if (pin && !isVaultPin(pin)) {
        throw new VaultError('pin-invalid');
      }

      const raw = await this.api.vault(path + '/devices', undefined, signal);
      const roster = rosterSchema.parse(raw);

      if (
        binding.key.generation !== 1 ||
        roster.phase !== 'ready' ||
        roster.key.generation !== binding.key.generation
      ) {
        throw new VaultError('recovery-required');
      }

      const approval = await this.confirmed(path, binding, custody, roster.epoch, signal, undefined, pin);

      await this.api.vault(path + '/devices/approve', approval, signal);

      signal.throwIfAborted();

      return { epoch: approval.authorization.epoch + 1, generation: binding.key.generation };
    } finally {
      pin?.fill(0);
    }
  }

  async confirmed(
    path: string,
    binding: WrappingContext,
    custody: DeviceCustody,
    epoch: number,
    signal: AbortSignal,
    initialKey?: Uint8Array,
    pin?: Uint8Array,
  ) {
    if (!this.vault.canResume(binding)) {
      throw new VaultError('locked');
    }

    const recovery = await prepareRecovery(
      this.api,
      path,
      this.vault,
      binding,
      custody,
      epoch,
      signal,
      initialKey,
      pin,
    );

    initialKey?.fill(0);

    await this.confirmFile(recovery.file, signal, recovery.approval.proof.expiresAt);

    signal.throwIfAborted();

    if (!this.vault.canResume(binding)) {
      throw new VaultError('locked');
    }

    return recovery.approval;
  }

  async bootstrap(
    path: string,
    binding: WrappingContext,
    custody: DeviceCustody,
    signal: AbortSignal,
    recovery?: Awaited<ReturnType<typeof prepareRecovery>>['approval'],
  ) {
    const keys = await custody.publicKeys();

    signal.throwIfAborted();

    const requested = await this.api.vault(`${path}/devices/request`, { deviceId: binding.deviceId, keys }, signal);

    signal.throwIfAborted();

    const proof = await custody.prove(deviceChallengeSchema.parse(requested));

    signal.throwIfAborted();

    await this.api.vault(`${path}/devices/bootstrap`, recovery ? { primary: proof, recovery } : proof, signal);

    signal.throwIfAborted();

    const roster = await this.api.vault(`${path}/devices`, undefined, signal);

    signal.throwIfAborted();

    return rosterSchema.parse(roster);
  }

  private async confirmFile(file: Blob, lifetime: AbortSignal, expiresAt: string): Promise<void> {
    const timeout = AbortSignal.timeout(Math.max(0, Date.parse(expiresAt) - Date.now()));
    const signal = AbortSignal.any([lifetime, timeout]);

    signal.throwIfAborted();
    const url = URL.createObjectURL(file);

    this.downloaded.set(false);
    this.recoveryDownload.set(url);
    let abort: () => void;

    try {
      await new Promise<void>((resolve, reject) => {
        this.saved = resolve;
        abort = () =>
          reject(
            timeout.aborted
              ? Object.assign(new Error(), { code: 'recovery_setup_expired' })
              : new VaultError('cancelled'),
          );

        signal.addEventListener('abort', abort, { once: true });
      });
    } finally {
      signal.removeEventListener('abort', abort!);
      this.saved = undefined;
      this.downloaded.set(false);
      this.recoveryDownload.set('');
      URL.revokeObjectURL(url);
    }
  }
}
