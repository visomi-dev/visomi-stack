import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import {
  VaultError,
  pairingCodeExchangeSchema,
  type DeviceProof,
  type PairingCodeExchange,
  type PairingCodeMessage,
  type SigningPin,
} from '@visomi-stack/shared-db';

import { ApproverPairingCode, RecipientPairingCode, pairingCodeIdentifiers } from './example-pairing-code';
import { watchVaultPairing } from './example-vault-pairing-watch';

type RecipientEnd = 'unconfirmed' | 'expired' | 'cancelled';

export class ExamplePairingExchange {
  private readonly attemptedReviews = new Set<string>();

  private recipientRequest?: DeviceProof;
  private recipientAttempt?: RecipientPairingCode;
  private recipientPin?: Uint8Array;
  private recipientCancellation?: AbortController;
  private stopRecipientCancellation?: () => void;
  private wakeRecipient?: () => void;
  private wakeApprover?: () => void;
  private wasCancelled = false;

  readonly code = signal('');
  readonly approval = signal<'waiting' | 'approved' | RecipientEnd>('waiting');

  readonly recipientEnd = computed(() => {
    const approval = this.approval();

    return approval === 'waiting' || approval === 'approved' ? null : approval;
  });

  authenticatedSigner?: SigningPin;

  constructor(
    private readonly view: Window,
    private readonly send: (proof: DeviceProof, signal: AbortSignal, message?: PairingCodeMessage) => Promise<unknown>,
    private readonly connected: () => boolean,
    private readonly retired: (error: unknown) => boolean,
    private readonly cancelRequest: (proof: DeviceProof) => Promise<unknown>,
  ) {}

  resume(signer: SigningPin | undefined, proof: DeviceProof): void {
    this.authenticatedSigner = signer;
    this.recipientRequest = proof;

    if (!signer) {
      this.endRecipient(Date.parse(proof.expiresAt) <= Date.now() ? 'expired' : 'unconfirmed');
    }
  }

  attempted(requestId: string): boolean {
    return this.attemptedReviews.has(requestId);
  }

  hasPin(): boolean {
    return !!this.recipientPin;
  }

  takePin(): Uint8Array | undefined {
    const pin = this.recipientPin;

    this.recipientPin = undefined;

    return pin;
  }

  wake(): void {
    this.wakeRecipient?.();
    this.wakeApprover?.();
  }

  watchRecipient<Approval>(
    proof: DeviceProof,
    signal: AbortSignal,
    checkpoint: (signer?: SigningPin) => void,
    readApproval: () => Promise<Approval | false>,
    onApproved: (auto: boolean, approval: Approval) => void,
  ): () => void {
    let retired = false;
    const watch = watchVaultPairing(
      this.view,
      async () => {
        try {
          const expired = Date.parse(proof.expiresAt) <= Date.now();
          const exchange = await (expired ? null : this.readPairingCode(proof, signal));

          signal.throwIfAborted();

          if (exchange === undefined) {
            return;
          }

          if (exchange) {
            retired = false;

            if (Boolean(exchange.r2) !== Boolean(this.authenticatedSigner)) {
              end();
            } else if (!this.authenticatedSigner && exchange.a1) {
              await this.acceptApprover(proof, exchange.a1, signal, checkpoint);
            }

            return;
          }

          if (!this.authenticatedSigner) {
            end();

            return;
          }

          const approval = await readApproval().catch(() => undefined);

          signal.throwIfAborted();

          if (approval === undefined) {
            return;
          }

          if (approval !== false) {
            const auto = !this.wasCancelled;

            stop();
            this.approval.set('approved');
            onApproved(auto, approval);
          } else if (retired || expired) {
            end();
          } else {
            // A concurrent approval may be between challenge consumption and committing its delivery.
            retired = true;
          }
        } catch {
          if (!signal.aborted) {
            end();
          }
        }
      },
      this.connected,
    );

    const stop = () => {
      if (this.wakeRecipient === watch.wake) {
        this.wakeRecipient = undefined;
      }

      watch.stop();
      signal.removeEventListener('abort', stop);
    };
    const end = () => {
      stop();

      if (this.approval() === 'waiting') {
        this.endRecipient(Date.parse(proof.expiresAt) <= Date.now() ? 'expired' : 'unconfirmed');
      }
    };

    this.wakeRecipient = watch.wake;

    if (signal.aborted) {
      stop();
    } else {
      signal.addEventListener('abort', stop, { once: true });
    }

    return stop;
  }

  async startRecipient(proof: DeviceProof, signal: AbortSignal, pin?: Uint8Array): Promise<void> {
    const cancellation = new AbortController();
    const active = AbortSignal.any([signal, cancellation.signal]);
    const timeout = AbortSignal.timeout(Math.min(300_000, Math.max(0, Date.parse(proof.expiresAt) - Date.now())));
    const cancel = () => {
      this.wasCancelled = true;

      if (!this.authenticatedSigner) {
        this.endRecipient();
      } else {
        this.clearRecipient();
      }
    };
    const expire = () => {
      if (!this.authenticatedSigner) {
        this.endRecipient('expired');
      } else {
        this.recipientPin?.fill(0);
        this.recipientPin = undefined;
      }
    };

    this.wasCancelled = false;
    this.recipientRequest = proof;
    this.recipientCancellation = cancellation;
    this.stopRecipientCancellation = () => {
      active.removeEventListener('abort', cancel);
      timeout.removeEventListener('abort', expire);
    };

    active.addEventListener('abort', cancel, { once: true });
    timeout.addEventListener('abort', expire, { once: true });

    try {
      const attempt = await RecipientPairingCode.start(this.view.crypto, active);

      this.recipientAttempt = attempt;

      await this.send(proof, active, { step: 'r1', r1: attempt.r1 });

      active.throwIfAborted();

      this.recipientPin = pin?.slice();
      const code = this.recipientAttempt.code;

      this.code.set(`${code.slice(0, 4)} ${code.slice(4)}`);
    } catch {
      if (this.approval() === 'waiting') {
        this.endRecipient();
      }
    }
  }

  async authenticateRecipient(
    proof: DeviceProof,
    signer: SigningPin,
    attempt: ApproverPairingCode,
    signal: AbortSignal,
  ): Promise<void> {
    const { requestId } = proof;

    if (this.attemptedReviews.has(requestId)) {
      throw new VaultError('corrupt');
    }

    this.attemptedReviews.add(requestId);

    const exchange = await this.readPairingCode(proof, signal);

    if (!exchange?.r1 || exchange.a1 || exchange.r2) {
      throw new VaultError('corrupt');
    }

    const identifiers = await pairingCodeIdentifiers(this.view.crypto, proof, signer);

    signal.throwIfAborted();

    const a1 = await attempt.start(exchange.r1, signer, identifiers);

    signal.throwIfAborted();

    await this.send(proof, signal, { step: 'a1', a1 });

    const r2 = await this.waitForRecipient(proof, signal);

    signal.throwIfAborted();
    attempt.finish(r2);
  }

  endRecipient(reason: RecipientEnd = 'unconfirmed'): void {
    this.authenticatedSigner = undefined;
    this.clearRecipient();
    this.approval.set(reason);
  }

  clearRecipient(): void {
    const request = this.recipientRequest;

    this.recipientRequest = undefined;
    this.stopRecipientCancellation?.();
    this.stopRecipientCancellation = undefined;
    this.recipientCancellation?.abort();
    this.recipientCancellation = undefined;
    this.recipientAttempt?.clear();
    this.recipientAttempt = undefined;
    this.code.set('');
    this.recipientPin?.fill(0);
    this.recipientPin = undefined;

    if (request && !this.authenticatedSigner) {
      void this.cancelRequest(request).catch(() => undefined);
    }
  }

  private waitForRecipient(proof: DeviceProof, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();

    return new Promise<string>((resolve, reject) => {
      const watch = watchVaultPairing(
        this.view,
        async () => {
          try {
            const exchange = await this.readPairingCode(proof, signal);

            signal.throwIfAborted();

            if (exchange === null || (exchange && !exchange.a1) || Date.parse(proof.expiresAt) <= Date.now()) {
              throw new VaultError('corrupt');
            }

            if (exchange?.r2) {
              stop();
              resolve(exchange.r2);
            }
          } catch {
            stop();
            reject(new VaultError('unavailable'));
          }
        },
        this.connected,
        { delayFirstCheck: true },
      );
      const stop = () => {
        this.wakeApprover = undefined;
        watch.stop();
        signal.removeEventListener('abort', cancel);
      };
      const cancel = () => {
        stop();
        reject(new VaultError('locked'));
      };

      this.wakeApprover = watch.wake;
      signal.addEventListener('abort', cancel, { once: true });
    });
  }

  private async readPairingCode(proof: DeviceProof, signal: AbortSignal) {
    let raw: unknown;

    try {
      const response = await this.send(proof, signal);

      raw = response;
    } catch (error) {
      signal.throwIfAborted();

      if (this.retired(error)) {
        return null;
      }

      if (error instanceof HttpErrorResponse && error.status > 0 && error.status < 500) {
        throw new VaultError('unavailable');
      }

      return undefined;
    }

    return pairingCodeExchangeSchema.parse(raw);
  }

  private async acceptApprover(
    proof: DeviceProof,
    answer: NonNullable<PairingCodeExchange['a1']>,
    signal: AbortSignal,
    checkpoint: (signer?: SigningPin) => void,
  ): Promise<void> {
    const attempt = this.recipientAttempt;
    const cancellation = this.recipientCancellation;

    if (!attempt || !cancellation) {
      throw new VaultError('corrupt');
    }

    const active = AbortSignal.any([signal, cancellation.signal]);
    const { signer } = answer;
    const identifiers = await pairingCodeIdentifiers(this.view.crypto, proof, signer);

    active.throwIfAborted();

    if (Date.parse(proof.expiresAt) <= Date.now()) {
      throw new VaultError('corrupt');
    }

    this.code.set('');
    this.recipientAttempt = undefined;
    const r2 = attempt.finish(answer, identifiers);

    // Checkpoint the authenticated pin before sending R2. A reload still checks that R2 landed.
    checkpoint(signer);
    this.authenticatedSigner = signer;

    try {
      await this.send(proof, active, { step: 'r2', r2 });
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status > 0 && error.status < 500) {
        checkpoint();

        throw new VaultError('corrupt');
      }
      // A lost reply can leave R2 committed. Check its slot or a completed delivery on the next read.
    }
  }
}
