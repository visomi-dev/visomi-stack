export * from './lib/crypto/cipher';
export { BrowserVault } from './lib/vault/browser-vault';
export { PrfUnlock } from './lib/vault/prf';
export { WebCryptoDevices, type DeviceIdentity } from './lib/crypto/devices';
export { provisionDeviceIdentity, restoreDeviceIdentity } from './lib/vault/identity-custody';
export {
  SyncReplica,
  replicaId,
  type ReplicaPin,
  type ReplicaStorage,
  type ReplicaTransport,
} from './lib/sync/replica';
export { exportEncryptedBackup, restoreEncryptedBackup } from './lib/vault/backup';
export { UserHeldRecovery } from './lib/vault/recovery';
export { createPrfCredential } from './lib/vault/prf-credential';
export { DeviceCustody, deviceCustodyContext } from './lib/vault/device-custody';
export { PinUnlock, createPinMethodId, isVaultPin, pinMethod } from './lib/vault/pin';
