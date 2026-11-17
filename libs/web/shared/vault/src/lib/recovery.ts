import {
  VaultError,
  wrappingContextSchema,
  type VaultUnlock,
  type WrappingContext,
} from '@visomi-stack/shared-persistence';

/** Explicit user-held recovery source. There is no cloud/password fallback or default recovery actor. */
export class UserHeldRecovery implements VaultUnlock {
  private controller: AbortController | undefined;

  constructor(
    private readonly readDisposableSecret: (context: WrappingContext, signal: AbortSignal) => Promise<Uint8Array>,
  ) {}

  async secret(context: WrappingContext): Promise<Uint8Array> {
    this.cancel();
    const binding = wrappingContextSchema.safeParse(context);

    if (!binding.success || binding.data.method !== 'recovery-key') {
      throw new VaultError('recovery-required');
    }

    const controller = new AbortController();

    this.controller = controller;
    let secret: Uint8Array | undefined;

    try {
      const value = await this.readDisposableSecret(binding.data, controller.signal);

      secret = value;

      if (controller.signal.aborted || this.controller !== controller) {
        throw new VaultError('cancelled');
      }

      if (secret.length !== 32) {
        throw new VaultError('corrupt');
      }

      const result = Uint8Array.from(secret);

      return result;
    } catch (error) {
      throw error instanceof VaultError
        ? error
        : new VaultError(controller.signal.aborted ? 'cancelled' : 'unavailable');
    } finally {
      secret?.fill(0);

      if (this.controller === controller) {
        this.controller = undefined;
      }
    }
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = undefined;
  }
}
