import {
  VaultError,
  keyDomainId,
  keyDomainSchema,
  type KeyDomain,
  type VaultStorage,
  type VaultUnlock,
  type WrappingContext,
} from '@visomi-stack/shared-db';

import type { WebCryptoCipher } from '../crypto/cipher';

export function historicalBinding(current: WrappingContext, key: KeyDomain): WrappingContext {
  const parsed = keyDomainSchema.safeParse(key);

  if (
    !parsed.success ||
    parsed.data.generation >= current.key.generation ||
    keyDomainId(current.ownerId, { ...parsed.data, generation: current.key.generation }) !==
      keyDomainId(current.ownerId, current.key)
  ) {
    throw new VaultError('corrupt');
  }

  return { ...current, key: parsed.data };
}

/** Transient unwrap only. No historical raw key or plaintext survives an operation or lock. */
export async function withStoredKey<T>(
  storage: VaultStorage,
  unlock: VaultUnlock,
  crypto: WebCryptoCipher,
  binding: WrappingContext,
  current: () => void,
  work: (raw: Uint8Array) => Promise<T>,
): Promise<T> {
  let secret: Uint8Array | undefined;
  let raw: Uint8Array | undefined;

  try {
    const envelope = await storage.getKey(keyDomainId(binding.ownerId, binding.key));

    current();

    if (!envelope) {
      throw new VaultError('recovery-required');
    }

    const unlocked = await unlock.secret(binding);

    secret = unlocked;
    current();
    const unwrapped = await crypto.unwrap(secret, binding, envelope);

    raw = unwrapped;
    current();
    const result = await work(raw);

    current();

    return result;
  } finally {
    secret?.fill(0);
    raw?.fill(0);
  }
}

export async function storeHistoricalKey(
  storage: VaultStorage,
  unlock: VaultUnlock,
  crypto: WebCryptoCipher,
  binding: WrappingContext,
  supplied: Uint8Array,
  current: () => void,
): Promise<void> {
  const raw = Uint8Array.from(supplied);
  let secret: Uint8Array | undefined;

  try {
    if (raw.length !== 32) {
      throw new VaultError('corrupt');
    }

    const unlocked = await unlock.secret(binding);

    secret = unlocked;
    current();
    const wrapped = await crypto.wrap(secret, raw, binding);

    current();

    // Historical grants authenticate replay; they never allocate a new old-generation nonce budget.
    await storage.putKey(keyDomainId(binding.ownerId, binding.key), wrapped, true);

    current();
  } finally {
    secret?.fill(0);
    raw.fill(0);
  }
}
