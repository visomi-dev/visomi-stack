import { z } from 'zod';

import { deviceKeyEnvelope, devicePairingInput } from './device-key-contract';

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const bytes32 = devicePairingInput.shape.challenge;

export const browserVaultPairing = z.strictObject({
  version: z.literal(1),
  purpose: z.literal('vault-browser-enrollment'),
  requestId: uuid,
  ownerUserId: uuid,
  personalScopeId: uuid,
  challenge: bytes32,
  expiresAt: z.iso.datetime(),
  keys: devicePairingInput.shape.keys,
  proof: z.string().regex(/^[A-Za-z0-9_-]{85}[AQgw]$/),
});
export const browserVaultBinding = browserVaultPairing
  .omit({
    version: true,
    purpose: true,
    expiresAt: true,
    keys: true,
    proof: true,
  })
  .extend({
    fingerprint: bytes32,
    recipientEncryption: devicePairingInput.shape.keys.shape.encryption,
    keyGeneration: z.literal(1),
  })
  .strict();
export const browserVaultConsume = z.strictObject({
  nonce: uuid,
  issuedAt: z.iso.datetime(),
  proof: browserVaultPairing.shape.proof,
});
export const browserVaultDelivery = deviceKeyEnvelope;

export type BrowserVaultPairing = z.infer<typeof browserVaultPairing>;
export type BrowserVaultBinding = z.infer<typeof browserVaultBinding>;
export type BrowserVaultConsume = z.infer<typeof browserVaultConsume>;
