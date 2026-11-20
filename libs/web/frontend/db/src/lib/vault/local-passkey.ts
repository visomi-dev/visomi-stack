import {
  VaultError,
  wrappingAad,
  type VaultUnlock,
  type WrappedKey,
  type WrappingContext,
} from '@visomi-stack/shared-db';

import type { WebCryptoCipher } from '../crypto/cipher';

import { withUnwrappedKey } from './stored-key';

export type LocalPasskeyStorage = {
  get(id: string): Promise<WrappedKey | undefined>;
  add(pin: WrappedKey, passkey: WrappedKey, signal: AbortSignal): Promise<void>;
};

export function isLocalPasskeyOf(pin: WrappingContext, passkey: WrappingContext): boolean {
  return (
    pin.method === 'pin-argon2id' &&
    passkey.method === 'passkey-prf' &&
    wrappingAad({ ...pin, method: passkey.method, methodId: passkey.methodId }) === wrappingAad(passkey)
  );
}

/** One enrollment operation per unlocked scope. The transaction owns the commit point. */
export class LocalPasskeyEnrollment {
  private pending?: AbortController;

  async add(options: {
    storage: LocalPasskeyStorage;
    original: WrappedKey;
    context: WrappingContext;
    pin: VaultUnlock;
    passkey: VaultUnlock;
    crypto: WebCryptoCipher;
    signal: AbortSignal;
    current: () => void;
  }): Promise<WrappingContext> {
    if (this.pending) {
      throw new VaultError('revision-conflict');
    }

    const { storage, original, context, pin, passkey, crypto, signal, current } = options;
    const controller = new AbortController();
    const cancellation = AbortSignal.any([signal, controller.signal]);
    const assertCurrent = () => {
      current();

      if (cancellation.aborted) {
        throw new VaultError('cancelled');
      }
    };

    this.pending = controller;

    try {
      const wrapped = await wrapLocalPasskey(original, context, pin, passkey, crypto, cancellation, assertCurrent);

      assertCurrent();

      await storage.add(original, wrapped, cancellation);

      return context;
    } finally {
      this.pending = undefined;
    }
  }

  cancel(): void {
    this.pending?.abort();
  }
}

async function wrapLocalPasskey(
  original: WrappedKey,
  context: WrappingContext,
  pin: VaultUnlock,
  passkey: VaultUnlock,
  crypto: WebCryptoCipher,
  signal: AbortSignal,
  current: () => void,
): Promise<WrappedKey> {
  const cancel = () => passkey.cancel();
  let secret: Uint8Array | undefined;

  signal.addEventListener('abort', cancel, { once: true });

  try {
    current();
    const verified = await passkey.secret(context);

    secret = verified;
    current();

    const wrapped = await withUnwrappedKey(pin, crypto, original.context, original, current, (raw) =>
      crypto.wrap(verified, raw, context),
    );

    return wrapped;
  } finally {
    secret?.fill(0);
    signal.removeEventListener('abort', cancel);
  }
}
