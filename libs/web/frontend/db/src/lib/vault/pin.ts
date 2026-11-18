import { argon2id } from 'hash-wasm';
import { VaultError, wrappingContextSchema, type VaultUnlock, type WrappingContext } from '@visomi-stack/shared-db';

import { decodeBytes, encodeBytes } from '../crypto/cipher';

// A fixed method name versions the KDF profile; stored data cannot choose weaker or unbounded parameters.
export const pinMethod = 'pin-argon2id' as const;
const parameters = { parallelism: 1, iterations: 3, memorySize: 65536, hashLength: 32, outputType: 'binary' as const };
let deriving = false;

export function isVaultPin(pin: Uint8Array): boolean {
  return pin.length === 6 && pin.every((byte) => byte >= 48 && byte <= 57);
}

export function createPinMethodId(crypto: Crypto): string {
  return encodeBytes(crypto.getRandomValues(new Uint8Array(32)));
}

/** Short PINs remain guessable offline. This increases attack cost, not PIN entropy. */
export class PinUnlock implements VaultUnlock {
  private epoch = 0;
  private secretBytes: Uint8Array | undefined;
  private identity: string | undefined;
  private controller = new AbortController();

  constructor(private readonly readDisposablePin: (signal: AbortSignal) => Promise<Uint8Array>) {}

  async secret(input: WrappingContext): Promise<Uint8Array> {
    const parsed = wrappingContextSchema.safeParse(input);

    if (!parsed.success || parsed.data.method !== pinMethod || parsed.data.methodId.length !== 43) {
      throw new VaultError('pin-invalid');
    }

    const context = parsed.data;
    const identity = JSON.stringify([context.ownerId, context.deviceId, context.origin, context.methodId]);

    if (this.secretBytes && this.identity === identity) {
      return Uint8Array.from(this.secretBytes);
    }

    if (this.secretBytes || deriving) {
      throw new VaultError('unavailable');
    }

    const epoch = this.epoch;
    const signal = this.controller.signal;
    let pin: Uint8Array | undefined;
    let derived: Uint8Array | undefined;

    try {
      const suppliedPin = await this.readDisposablePin(signal);

      pin = suppliedPin;

      if (epoch !== this.epoch || signal.aborted) {
        throw new VaultError('cancelled');
      }

      if (!isVaultPin(pin)) {
        throw new VaultError('pin-invalid');
      }

      if (deriving) {
        throw new VaultError('unavailable');
      }

      deriving = true;

      try {
        const result = await argon2id({ ...parameters, password: pin, salt: decodeBytes(context.methodId, 32) });

        derived = result;
      } finally {
        deriving = false;
      }

      if (epoch !== this.epoch || signal.aborted) {
        throw new VaultError('cancelled');
      }

      this.identity = identity;
      this.secretBytes = Uint8Array.from(derived);

      return Uint8Array.from(derived);
    } catch (error) {
      throw error instanceof VaultError ? error : new VaultError('unavailable');
    } finally {
      pin?.fill(0);
      derived?.fill(0);
    }
  }

  cancel(): void {
    this.epoch++;
    this.controller.abort();
    this.controller = new AbortController();
    this.secretBytes?.fill(0);
    this.secretBytes = undefined;
    this.identity = undefined;
  }
}
