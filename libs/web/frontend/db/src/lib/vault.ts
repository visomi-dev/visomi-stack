import {
  CryptoContractError,
  dataContextSchema,
  keyDomainId,
  protocolIdSchema,
  parseProductPolicy,
  wrappedKeySchema,
  deliveryBindingSchema,
  vaultUnitId,
  wrappingContextSchema,
  VaultError,
  type DataContext,
  type DataEnvelope,
  type VaultPort,
  type VaultState,
  type VaultStorage,
  type VaultUnlock,
  type WrappingContext,
  type DeliveryBinding,
  type DeviceDelivery,
  type ProductPolicy,
  type WrappedKey,
  type KeyDomain,
} from '@visomi-stack/shared-db';

import { WebCryptoCipher } from './crypto';
import type { WebCryptoDevices } from './devices';
import { historicalBinding, storeHistoricalKey, withStoredKey } from './stored-key';

/** One independently locked key scope; records are loaded/decrypted individually. */
export class BrowserVault implements VaultPort {
  private readonly recoveryOperations = new Set<VaultUnlock>();

  private phase: VaultState = 'locked';
  private epoch = 0;
  private key: CryptoKey | undefined;
  private binding: WrappingContext | undefined;
  private closed = false;

  constructor(
    private readonly ownerId: string,
    private readonly storage: VaultStorage,
    private readonly unlocker: VaultUnlock,
    private readonly crypto: WebCryptoCipher,
    private readonly changed: (state: VaultState) => void = () => undefined,
    private readonly channel?: BroadcastChannel,
  ) {
    if (!protocolIdSchema.safeParse(ownerId).success) {
      throw new VaultError('unavailable');
    }

    channel?.addEventListener('message', this.message);
  }

  get state(): VaultState {
    return this.phase;
  }

  async initialize(context: WrappingContext): Promise<void> {
    return this.initializeKey(context);
  }

  /** Explicit approved recipient/recovery path; never used as an implicit fallback from unlock. */
  async install(context: WrappingContext, supplied: Uint8Array): Promise<void> {
    if (supplied.length !== 32) {
      throw new VaultError('corrupt');
    }

    return this.initializeKey(context, supplied);
  }

  /** Caller verifies the signed recipient grant first. Keep current writing authority selected. */
  async installHistory(key: KeyDomain, supplied: Uint8Array): Promise<void> {
    if (!this.binding || !this.key) {
      throw new VaultError('locked');
    }

    const epoch = this.epoch;
    const binding = historicalBinding(this.binding, key);

    try {
      await storeHistoricalKey(this.storage, this.unlocker, this.crypto, binding, supplied, () => this.current(epoch));
    } catch (error) {
      throw this.failure(error, epoch);
    }
  }

  async unlock(context: WrappingContext): Promise<void> {
    this.lock(false);
    const epoch = this.epoch;
    const binding = this.context(context);
    let secret: Uint8Array | undefined;
    let raw: Uint8Array | undefined;

    try {
      const wrapped = await this.storage.getKey(keyDomainId(this.ownerId, binding.key));

      this.current(epoch);

      if (!wrapped) {
        throw new VaultError('recovery-required');
      }

      const unlockedSecret = await this.unlocker.secret(binding);

      secret = unlockedSecret;
      this.current(epoch);
      const unwrapped = await this.crypto.unwrap(secret, binding, wrapped);

      raw = unwrapped;
      const key = await this.crypto.importDataKey(raw);

      this.current(epoch);
      this.key = key;
      this.binding = binding;
      this.setState('ready');
    } catch (error) {
      throw this.failure(error, epoch);
    } finally {
      secret?.fill(0);
      raw?.fill(0);
    }
  }

  async seal(context: DataContext, plaintext: Uint8Array): Promise<DataEnvelope> {
    return this.sealUnit(context, plaintext, true);
  }

  /** Prepare a unit for an independently atomic sync outbox; plaintext never enters that outbox. */
  async encrypt(context: DataContext, plaintext: Uint8Array): Promise<DataEnvelope> {
    return this.sealUnit(context, plaintext, false);
  }

  async open(context: DataContext): Promise<Uint8Array> {
    const epoch = this.epoch;
    const parsed = dataContextSchema.safeParse(context);

    if (!parsed.success) {
      throw new VaultError('corrupt');
    }

    const operation = parsed.data;
    const key = this.dataKey(operation);
    let plaintext: Uint8Array | undefined;

    try {
      const envelope = await this.storage.getUnit(vaultUnitId(this.ownerId, operation));

      this.current(epoch);

      if (!envelope) {
        throw new VaultError('unavailable');
      }

      const opened = await this.crypto.open(key, operation, envelope);

      plaintext = opened;
      this.current(epoch);

      return plaintext;
    } catch (error) {
      plaintext?.fill(0);

      throw this.failure(error, epoch);
    }
  }

  async decrypt(context: DataContext, envelope: DataEnvelope): Promise<Uint8Array> {
    const epoch = this.epoch;
    const parsed = dataContextSchema.safeParse(context);

    if (!parsed.success) {
      throw new VaultError('corrupt');
    }

    const key = await this.decryptionKey(parsed.data);
    let plaintext: Uint8Array | undefined;

    try {
      const opened = await this.crypto.open(key, parsed.data, envelope);

      plaintext = opened;
      this.current(epoch);

      return plaintext;
    } catch (error) {
      plaintext?.fill(0);

      throw this.failure(error, epoch);
    }
  }

  async deliver(recipient: DeliveryBinding, devices: WebCryptoDevices): Promise<DeviceDelivery> {
    const parsed = deliveryBindingSchema.safeParse(recipient);

    if (!parsed.success) {
      throw new VaultError('corrupt');
    }

    if (
      !this.binding ||
      !this.key ||
      keyDomainId(this.ownerId, parsed.data.key) !== keyDomainId(this.ownerId, this.binding.key)
    ) {
      throw new VaultError('locked');
    }

    return this.withRawKey((raw) => devices.seal(raw, parsed.data));
  }

  /** Explicit historical grant preparation; the caller signs this ciphertext in the current approval body. */
  async deliverHistory(recipient: DeliveryBinding, devices: WebCryptoDevices): Promise<DeviceDelivery> {
    const parsed = deliveryBindingSchema.safeParse(recipient);

    if (!parsed.success) {
      throw new VaultError('corrupt');
    }

    if (!this.binding || !this.key) {
      throw new VaultError('locked');
    }

    const binding = historicalBinding(this.binding, parsed.data.key);

    return this.withRawKey((raw) => devices.seal(raw, parsed.data), binding);
  }

  async createRecovery(policy: ProductPolicy, context: WrappingContext, recovery: VaultUnlock): Promise<WrappedKey> {
    const binding = this.context(context);

    this.recoveryPolicy(policy, binding);
    this.recoveryOperations.add(recovery);

    try {
      const result = await this.withRawKey(async (raw) => {
        const secret = await recovery.secret(binding);

        try {
          const envelope = await this.crypto.wrap(secret, raw, binding);

          return envelope;
        } finally {
          secret.fill(0);
        }
      });

      return result;
    } finally {
      this.recoveryOperations.delete(recovery);
    }
  }

  /** Explicitly verified recipient set; no cloud roster is implicitly trusted or fetched here. */
  async deliverBatch(recipients: readonly DeliveryBinding[], devices: WebCryptoDevices): Promise<DeviceDelivery[]> {
    const parsed = deliveryBindingSchema.array().min(1).max(64).safeParse(recipients);
    const binding = this.binding;

    if (!parsed.success || new Set(recipients.map((recipient) => recipient.deviceId)).size !== recipients.length) {
      throw new VaultError('corrupt');
    }

    if (
      !binding ||
      !this.key ||
      parsed.data.some(
        (recipient) => keyDomainId(this.ownerId, recipient.key) !== keyDomainId(this.ownerId, binding.key),
      )
    ) {
      throw new VaultError('locked');
    }

    const epoch = this.epoch;

    return this.withRawKey(async (raw) => {
      const deliveries: DeviceDelivery[] = [];

      for (const recipient of parsed.data) {
        this.current(epoch);
        const delivery = await devices.seal(raw, recipient);

        this.current(epoch);
        deliveries.push(delivery);
      }

      return deliveries;
    });
  }

  async installRecovery(
    policy: ProductPolicy,
    recoveryContext: WrappingContext,
    envelope: WrappedKey,
    recovery: VaultUnlock,
    localContext: WrappingContext,
    minimumGeneration: number,
  ): Promise<void> {
    const binding = this.context(recoveryContext);
    const local = this.context(localContext);

    this.recoveryPolicy(policy, binding, false);
    const parsed = wrappedKeySchema.safeParse(envelope);

    if (
      !parsed.success ||
      !Number.isInteger(minimumGeneration) ||
      minimumGeneration < 1 ||
      local.key.generation < minimumGeneration ||
      local.method !== 'passkey-prf' ||
      keyDomainId(this.ownerId, binding.key) !== keyDomainId(this.ownerId, local.key)
    ) {
      throw new VaultError('corrupt');
    }

    this.lock(false);
    const epoch = this.epoch;

    this.recoveryOperations.add(recovery);
    let secret: Uint8Array | undefined;
    let raw: Uint8Array | undefined;

    try {
      const recovered = await recovery.secret(binding);

      secret = recovered;
      this.current(epoch);
      const unwrapped = await this.crypto.unwrap(secret, binding, parsed.data);

      raw = unwrapped;
      this.current(epoch);
      this.recoveryOperations.delete(recovery);

      await this.initializeKey(local, raw, true);
    } finally {
      this.recoveryOperations.delete(recovery);
      secret?.fill(0);
      raw?.fill(0);
    }
  }

  async forget(context: WrappingContext): Promise<void> {
    const binding = this.context(context);

    this.lock();
    const epoch = this.epoch;

    await this.storage.deleteKey(keyDomainId(this.ownerId, binding.key));

    this.current(epoch);
    this.setState('recovery-required');
  }

  lock(broadcast = true): void {
    this.epoch++;
    this.key = undefined;
    this.binding = undefined;
    this.unlocker.cancel();
    for (const recovery of this.recoveryOperations) {
      recovery.cancel();
    }
    this.recoveryOperations.clear();
    this.setState(this.closed ? 'unavailable' : 'locked');

    if (broadcast) {
      try {
        this.channel?.postMessage('lock');
      } catch {
        this.setState('unavailable');
      }
    }
  }

  close(broadcast = true): void {
    this.lock(broadcast);
    this.closed = true;
    this.channel?.removeEventListener('message', this.message);
    this.channel?.close();
    this.storage.close();
    this.setState('unavailable');
  }

  private async sealUnit(context: DataContext, plaintext: Uint8Array, persist: boolean): Promise<DataEnvelope> {
    const epoch = this.epoch;
    const parsed = dataContextSchema.safeParse(context);

    if (!parsed.success) {
      throw new VaultError('corrupt');
    }

    const operation = parsed.data;
    const key = this.dataKey(operation);
    const copy = Uint8Array.from(plaintext);

    try {
      // Local per-generation accounting only; global multi-device budget remains a release gate.
      await this.storage.reserveEncryption(keyDomainId(this.ownerId, operation.key), 1_048_576);

      this.current(epoch);
      const envelope = await this.crypto.seal(key, operation, copy);

      this.current(epoch);

      if (persist) {
        await this.storage.putUnit(vaultUnitId(this.ownerId, operation), operation.revision - 1, envelope);

        this.current(epoch);
      }

      return envelope;
    } catch (error) {
      throw this.failure(error, epoch);
    } finally {
      copy.fill(0);
    }
  }

  private async initializeKey(context: WrappingContext, supplied?: Uint8Array, exhausted = false): Promise<void> {
    this.lock(false);
    const epoch = this.epoch;
    const binding = this.context(context);
    const id = keyDomainId(this.ownerId, binding.key);
    let secret: Uint8Array | undefined;
    let raw: Uint8Array | undefined = supplied ? Uint8Array.from(supplied) : undefined;

    try {
      const current = await this.storage.getKey(id);

      this.current(epoch);

      if (current) {
        throw new VaultError('revision-conflict');
      }

      const unlockedSecret = await this.unlocker.secret(binding);

      secret = unlockedSecret;
      this.current(epoch);
      raw ??= this.crypto.randomBytes(32);
      const wrapped = await this.crypto.wrap(secret, raw, binding);
      const key = await this.crypto.importDataKey(raw);

      this.current(epoch);

      await this.storage.putKey(id, wrapped, exhausted);

      this.current(epoch);
      this.key = key;
      this.binding = binding;
      this.setState('ready');
    } catch (error) {
      throw this.failure(error, epoch);
    } finally {
      secret?.fill(0);
      raw?.fill(0);
    }
  }

  private recoveryPolicy(input: ProductPolicy, context: WrappingContext, requireUnlocked = true): void {
    const policy = parseProductPolicy(input);
    const binding = this.context(context);
    const domain = policy.domains.find((domain) => domain.domain === binding.key.domain);

    if (
      binding.method !== 'recovery-key' ||
      policy.product !== binding.key.product ||
      domain?.readers !== 'client-keys-only' ||
      domain.recovery !== 'user-held-recovery-key' ||
      domain.keyScope !== binding.key.scope.kind ||
      (requireUnlocked &&
        (!this.binding ||
          !this.key ||
          keyDomainId(this.ownerId, this.binding.key) !== keyDomainId(this.ownerId, binding.key)))
    ) {
      throw new VaultError('recovery-required');
    }
  }

  private async withRawKey<T>(work: (raw: Uint8Array) => Promise<T>, binding = this.binding): Promise<T> {
    if (!binding || !this.key) {
      throw new VaultError('locked');
    }

    const epoch = this.epoch;

    try {
      const result = await withStoredKey(
        this.storage,
        this.unlocker,
        this.crypto,
        binding,
        () => this.current(epoch),
        work,
      );

      return result;
    } catch (error) {
      throw this.failure(error, epoch);
    }
  }

  private readonly message = (event: MessageEvent<unknown>) => {
    if (event.data === 'lock') {
      this.lock(false);
    }
  };

  private context(context: WrappingContext): WrappingContext {
    const result = wrappingContextSchema.safeParse(context);

    if (this.closed || !result.success || result.data.ownerId !== this.ownerId) {
      throw new VaultError('unavailable');
    }

    return result.data;
  }

  private dataKey(context: DataContext): CryptoKey {
    if (this.closed || !this.key || !this.binding) {
      throw new VaultError('locked');
    }

    const result = dataContextSchema.safeParse(context);

    if (!result.success || keyDomainId(this.ownerId, context.key) !== keyDomainId(this.ownerId, this.binding.key)) {
      throw new VaultError('corrupt');
    }

    return this.key;
  }

  private async decryptionKey(context: DataContext): Promise<CryptoKey> {
    if (this.binding && context.key.generation < this.binding.key.generation) {
      return this.withRawKey((raw) => this.crypto.importDataKey(raw), historicalBinding(this.binding, context.key));
    }

    return this.dataKey(context);
  }

  private current(epoch: number): void {
    if (this.closed || epoch !== this.epoch) {
      throw new VaultError('stale-operation');
    }
  }

  private failure(error: unknown, epoch: number): VaultError {
    if (this.closed || epoch !== this.epoch) {
      return new VaultError('stale-operation');
    }

    const code =
      error instanceof VaultError ? error.code : error instanceof CryptoContractError ? error.code : 'unavailable';
    const state: VaultState =
      code === 'quota' || code === 'quota-exceeded'
        ? 'quota'
        : code === 'recovery-required'
          ? 'recovery-required'
          : code === 'unsupported-prf'
            ? 'unsupported-prf'
            : code === 'cancelled'
              ? 'cancelled'
              : code === 'origin-mismatch'
                ? 'origin-mismatch'
                : ['integrity-failure', 'context-mismatch', 'key-invalid', 'malformed', 'corrupt'].includes(code)
                  ? 'corrupt'
                  : 'unavailable';

    this.setState(state);

    if (state !== 'quota') {
      this.key = undefined;
      this.binding = undefined;
      // Failed authentication invalidates other in-flight reads under this unlocked state as well.
      this.epoch++;
      this.unlocker.cancel();
    }

    return error instanceof VaultError ? error : new VaultError(state);
  }

  private setState(state: VaultState): void {
    this.phase = state;
    this.changed(state);
  }
}
