import { z } from 'zod';

import { encodedBytes, keyDomainSchema, protocolIdSchema, scopeTuple } from './crypto-contract';

export const devicePublicKeysSchema = z.strictObject({ signing: encodedBytes(91), encryption: encodedBytes(422) });
export const deviceChallengeSchema = z.strictObject({
  format: z.literal('visomi.device-enrollment'),
  version: z.literal(1),
  key: keyDomainSchema,
  ownerId: protocolIdSchema,
  deviceId: protocolIdSchema,
  requestId: protocolIdSchema,
  challenge: encodedBytes(32),
  expiresAt: z.iso.datetime({ precision: 3 }),
  keys: devicePublicKeysSchema,
});
export const deviceProofSchema = deviceChallengeSchema.extend({ proof: encodedBytes(64) });
export type DeviceChallenge = z.infer<typeof deviceChallengeSchema>;
export type DeviceProof = z.infer<typeof deviceProofSchema>;

/** Possession proof bytes, not membership, approval, expiry or consumption authority. */
export function deviceProofMessage(input: DeviceChallenge): string {
  const { proof: _proof, ...challenge } = input as DeviceProof;
  const value = deviceChallengeSchema.parse(challenge);

  return JSON.stringify([
    'visomi.device-enrollment',
    1,
    value.key.product,
    value.key.domain,
    scopeTuple(value.key.scope),
    value.key.generation,
    value.ownerId,
    value.deviceId,
    value.requestId,
    value.challenge,
    value.expiresAt,
    value.keys.signing,
    value.keys.encryption,
  ]);
}

export const deliveryBindingSchema = z.strictObject({
  key: keyDomainSchema,
  ownerId: protocolIdSchema,
  deviceId: protocolIdSchema,
  requestId: protocolIdSchema,
  challenge: encodedBytes(32),
  fingerprint: encodedBytes(32),
  encryption: encodedBytes(422),
});
export const deviceDeliverySchema = z.strictObject({
  format: z.literal('visomi.device-key'),
  version: z.literal(1),
  algorithm: z.literal('RSA-OAEP-3072-SHA-256'),
  binding: deliveryBindingSchema,
  ciphertext: encodedBytes(384),
});
export type DeliveryBinding = z.infer<typeof deliveryBindingSchema>;
export type DeviceDelivery = z.infer<typeof deviceDeliverySchema>;
/** Explicit recipient grants for earlier generations; never an implicit server key archive. */
export const deviceHistorySchema = z.array(deviceDeliverySchema).min(1).max(64);

export const deviceActionSchema = z.strictObject({
  key: keyDomainSchema,
  deviceId: protocolIdSchema,
  operationId: protocolIdSchema,
  epoch: z.number().int().min(1).max(2_147_483_647),
  action: z.enum(['approve', 'revoke', 'rotate', 'sync']),
  bodyHash: encodedBytes(32),
  signature: encodedBytes(64),
});
export type DeviceAction = z.infer<typeof deviceActionSchema>;

export const approvedDeliverySchema = z.strictObject({
  format: z.literal('visomi.approved-device-key'),
  version: z.literal(1),
  delivery: deviceDeliverySchema,
  authorization: deviceActionSchema,
  witness: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('enrollment'),
      proof: deviceProofSchema,
      delivery: deviceDeliverySchema,
      history: deviceHistorySchema.optional(),
    }),
    z.strictObject({ kind: z.literal('rotation'), deliveries: z.array(deviceDeliverySchema).min(1).max(64) }),
  ]),
});
export type ApprovedDelivery = z.infer<typeof approvedDeliverySchema>;
export const signingPinSchema = z.strictObject({ deviceId: protocolIdSchema, signing: encodedBytes(91) });
export type SigningPin = z.infer<typeof signingPinSchema>;

export function deviceActionMessage(input: Omit<DeviceAction, 'signature'>): string {
  const { signature: _signature, ...action } = input as DeviceAction;
  const value = deviceActionSchema.omit({ signature: true }).parse(action);

  return JSON.stringify([
    'visomi.device-action',
    1,
    value.key.product,
    value.key.domain,
    scopeTuple(value.key.scope),
    value.key.generation,
    value.deviceId,
    value.operationId,
    value.epoch,
    value.action,
    value.bodyHash,
  ]);
}

export function deviceDeliveryLabel(input: DeliveryBinding): string {
  const value = deliveryBindingSchema.parse(input);

  return JSON.stringify([
    'visomi.device-key',
    1,
    'RSA-OAEP-3072-SHA-256',
    value.key.product,
    value.key.domain,
    scopeTuple(value.key.scope),
    value.key.generation,
    value.ownerId,
    value.deviceId,
    value.requestId,
    value.challenge,
    value.fingerprint,
    value.encryption,
  ]);
}
