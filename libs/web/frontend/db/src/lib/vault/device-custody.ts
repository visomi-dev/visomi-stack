import {
  VaultError,
  vaultUnitId,
  wrappingContextSchema,
  type DataContext,
  type DeliveryBinding,
  type DeviceAction,
  type DeviceChallenge,
  type ApprovedDelivery,
  type SigningPin,
  type VaultStorage,
  type VaultUnlock,
  type WrappingContext,
} from '@visomi-stack/shared-db';

import { WebCryptoCipher } from '../crypto/cipher';
import { WebCryptoDevices, type DeviceIdentity } from '../crypto/devices';

import { provisionDeviceIdentity, restoreDeviceIdentity } from './identity-custody';
import { BrowserVault } from './browser-vault';

export function deviceCustodyContext(input: WrappingContext): WrappingContext {
  const value = wrappingContextSchema.parse(input);

  if (!['passkey-prf', 'pin-argon2id'].includes(value.method)) {
    throw new VaultError('unsupported-prf');
  }

  return {
    ...value,
    key: {
      product: value.key.product,
      domain: 'device-custody',
      scope: { kind: 'resource', tenantId: value.key.scope.tenantId, groupId: null, resourceId: value.deviceId },
      generation: 1,
    },
  };
}

/** Signing/decryption identity is encrypted under an independent local unlock vault, never the shared resource DEK. */
export class DeviceCustody {
  private readonly binding: WrappingContext;
  private readonly context: DataContext;
  private readonly vault: BrowserVault;
  private readonly devices: WebCryptoDevices;

  private identity: DeviceIdentity | undefined;
  private epoch = 0;

  constructor(
    private readonly storage: VaultStorage,
    dataBinding: WrappingContext,
    unlock: VaultUnlock,
    private readonly crypto: Crypto,
    channel?: BroadcastChannel,
  ) {
    this.binding = deviceCustodyContext(dataBinding);
    this.context = {
      key: this.binding.key,
      target: this.binding.key.scope,
      objectId: this.binding.deviceId,
      schemaVersion: 1,
      revision: 1,
      kind: 'record',
      previousCheckpoint: null,
    };
    this.devices = new WebCryptoDevices(crypto);
    this.vault = new BrowserVault(
      this.binding.ownerId,
      storage,
      unlock,
      new WebCryptoCipher(crypto),
      (state) => {
        if (state !== 'ready') {
          this.identity = undefined;
          this.epoch++;
        }
      },
      channel,
    );
  }

  get ready(): boolean {
    return Boolean(this.identity && this.vault.state === 'ready');
  }

  async unlock(provision: boolean | 'resume' = false, unlock?: VaultUnlock): Promise<void> {
    this.identity = undefined;
    // Starting the vault operation synchronously emits its initial lock. Capture before yielding to other operations.
    const unlocking =
      provision === true ? this.vault.initialize(this.binding, unlock) : this.vault.unlock(this.binding, unlock);
    const epoch = this.epoch;

    await unlocking;

    this.current(epoch);

    // Initial setup can be interrupted after storing the wrapper but before sealing the identity.
    const present = await (provision === 'resume'
      ? this.storage.getUnit(vaultUnitId(this.binding.ownerId, this.context))
      : undefined);

    this.current(epoch);

    if (provision === true || (provision === 'resume' && !present)) {
      const identity = await provisionDeviceIdentity(this.crypto, async (material) => {
        await this.vault.seal(this.context, material);
      });

      this.current(epoch);
      this.identity = identity;
    } else {
      const material = await this.vault.open(this.context);

      try {
        const identity = await restoreDeviceIdentity(this.crypto, material);

        this.current(epoch);
        this.identity = identity;
      } finally {
        material.fill(0);
      }
    }
  }

  async publicKeys() {
    const { identity, epoch } = this.active();
    const keys = await this.devices.publicKeys(identity);

    this.current(epoch);

    return keys;
  }

  async prove(challenge: DeviceChallenge) {
    const { identity, epoch } = this.active();

    if (
      challenge.ownerId !== this.binding.ownerId ||
      challenge.deviceId !== this.binding.deviceId ||
      challenge.key.product !== this.binding.key.product ||
      challenge.key.scope.tenantId !== this.binding.key.scope.tenantId
    ) {
      throw new VaultError('corrupt');
    }

    const proof = await this.devices.prove(identity, challenge);

    this.current(epoch);

    return proof;
  }

  async sign(input: Omit<DeviceAction, 'signature'>) {
    const { identity, epoch } = this.active();

    if (
      input.deviceId !== this.binding.deviceId ||
      input.key.product !== this.binding.key.product ||
      input.key.scope.tenantId !== this.binding.key.scope.tenantId
    ) {
      throw new VaultError('corrupt');
    }

    const action = await this.devices.signAction(identity, input);

    this.current(epoch);

    return action;
  }

  async open(
    binding: DeliveryBinding,
    delivery: ApprovedDelivery,
    trusted: SigningPin,
    historicalGeneration?: number,
  ): Promise<Uint8Array> {
    const { identity, epoch } = this.active();

    if (
      binding.ownerId !== this.binding.ownerId ||
      binding.deviceId !== this.binding.deviceId ||
      binding.key.product !== this.binding.key.product ||
      binding.key.scope.tenantId !== this.binding.key.scope.tenantId
    ) {
      throw new VaultError('corrupt');
    }

    let raw: Uint8Array | undefined;

    try {
      const result = await this.devices.accept(
        identity.encryption.privateKey,
        binding,
        delivery,
        trusted,
        historicalGeneration,
      );

      raw = result;
      this.current(epoch);

      return raw;
    } catch (error) {
      raw?.fill(0);

      throw error;
    }
  }

  lock(): void {
    this.identity = undefined;
    this.epoch++;
    this.vault.lock();
  }

  close(): void {
    this.lock();
    this.vault.close();
  }

  private active() {
    if (!this.identity || this.vault.state !== 'ready') {
      throw new VaultError('locked');
    }

    return { identity: this.identity, epoch: this.epoch };
  }

  private current(epoch: number) {
    if (epoch !== this.epoch || this.vault.state !== 'ready') {
      throw new VaultError('stale-operation');
    }
  }
}
