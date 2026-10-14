// Keep the Argon2id/WASM dependency out of ordinary envelope/session imports.
export { derivePinWrappingKey, isVaultPinValid } from './lib/vault-pin-key';
