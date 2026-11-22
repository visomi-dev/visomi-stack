import {
  scopeTuple,
  type DataContext,
  type DataEnvelope,
  type KeyDomain,
  type WrappedKey,
  type WrappingContext,
} from './crypto-contract';

export type VaultState =
  | 'locked'
  | 'ready'
  | 'unavailable'
  | 'corrupt'
  | 'quota'
  | 'recovery-required'
  | 'unsupported-prf'
  | 'cancelled'
  | 'origin-mismatch'
  | 'pin-invalid';
export type VaultFailure =
  VaultState | 'stale-operation' | 'revision-conflict' | 'unsupported-version' | 'passkey-not-registered';

export class VaultError extends Error {
  constructor(readonly code: VaultFailure) {
    super(code);
    this.name = 'VaultError';
  }
}

/** Ciphertext-only storage. Platform adapters own atomicity, quotas and teardown. */
export type VaultStorage = {
  getKey(id: string): Promise<WrappedKey | undefined>;
  putKey(id: string, envelope: WrappedKey, exhausted?: boolean): Promise<void>;
  reserveEncryption(id: string, limit: number): Promise<void>;
  getUnit(id: string): Promise<DataEnvelope | undefined>;
  putUnit(id: string, expectedRevision: number, envelope: DataEnvelope): Promise<void>;
  deleteKey(id: string): Promise<void>;
  /** Empty destination only; all ciphertext and wrapper commit atomically. Restored keys exhaust local write budget. */
  restore(
    key: { id: string; envelope: WrappedKey },
    units: readonly { id: string; envelope: DataEnvelope }[],
  ): Promise<void>;
  close(): void;
};

/** A credential ceremony returns a transient secret, never a server unwrap capability. */
export type VaultUnlock = {
  secret(context: WrappingContext): Promise<Uint8Array>;
  cancel(): void;
};

export type VaultPort = {
  readonly state: VaultState;
  initialize(context: WrappingContext): Promise<void>;
  unlock(context: WrappingContext): Promise<void>;
  seal(context: DataContext, plaintext: Uint8Array): Promise<DataEnvelope>;
  encrypt(context: DataContext, plaintext: Uint8Array): Promise<DataEnvelope>;
  open(context: DataContext): Promise<Uint8Array>;
  decrypt(context: DataContext, envelope: DataEnvelope): Promise<Uint8Array>;
  lock(): void;
  close(): void;
};

export function keyDomainId(ownerId: string, domain: KeyDomain): string {
  return JSON.stringify([ownerId, domain.product, domain.domain, scopeTuple(domain.scope), domain.generation]);
}

export function vaultUnitId(ownerId: string, context: DataContext): string {
  // Object identity follows its target; key rotation does not create another object.
  return JSON.stringify([
    ownerId,
    context.key.product,
    context.key.domain,
    scopeTuple(context.target),
    context.objectId,
  ]);
}
