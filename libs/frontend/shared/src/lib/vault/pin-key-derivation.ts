import { pinWorkerRequest } from './pin-worker-contract';

import { assertVaultCryptoKey } from 'shared-crypto';
import type { LocalPinEnvelope } from 'shared-crypto';

/** A fresh worker per attempt keeps Argon2 off the main thread and makes cancellation destructive. */
export class PinKeyDerivation {
  private readonly jobs = new Set<() => void>();

  constructor(private readonly createWorker: () => Worker) {}

  cancel(): void {
    for (const cancel of this.jobs) {
      cancel();
    }
  }

  async derive(pin: string, envelope: LocalPinEnvelope, signal?: AbortSignal): Promise<CryptoKey> {
    if (signal?.aborted) {
      throw new Error('pin_derivation_cancelled');
    }

    const request = pinWorkerRequest.parse({ id: crypto.randomUUID(), pin, envelope });

    return await new Promise<CryptoKey>((resolve, reject) => {
      let worker: Worker;

      try {
        worker = this.createWorker();
      } catch {
        reject(new Error('pin_worker_unavailable'));

        return;
      }

      let finished = false;
      const finish = (error?: string, key?: CryptoKey) => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        this.jobs.delete(cancel);
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
        if (error || !key) {
          reject(new Error(error ?? 'pin_derivation_failed'));
        } else {
          resolve(key);
        }
      };
      const cancel = () => finish('pin_derivation_cancelled');
      const timer = setTimeout(() => finish('pin_worker_timeout'), 10_000);

      this.jobs.add(cancel);
      signal?.addEventListener('abort', cancel, { once: true });
      worker.onerror = () => finish('pin_worker_unavailable');
      worker.onmessageerror = () => finish('pin_derivation_failed');
      worker.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (
          typeof data !== 'object' ||
          data === null ||
          !('id' in data) ||
          data.id !== request.id ||
          !('key' in data) ||
          Object.keys(data).length !== 2
        ) {
          finish('pin_derivation_failed');

          return;
        }

        try {
          if (!(data.key instanceof CryptoKey)) {
            throw new Error('invalid_vault_crypto_key');
          }

          assertVaultCryptoKey(data.key);
          finish(undefined, data.key);
        } catch {
          finish('pin_derivation_failed');
        }
      };

      if (signal?.aborted) {
        cancel();

        return;
      }

      try {
        worker.postMessage(request);
      } catch {
        finish('pin_worker_unavailable');
      }
    });
  }
}
