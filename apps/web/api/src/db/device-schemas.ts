import {
  deviceActionSchema,
  deviceDeliverySchema,
  deviceHistorySchema,
  deviceProofSchema,
  devicePublicKeysSchema,
  protocolIdSchema,
} from '@visomi-stack/shared-db';
import { z } from 'zod';

export const enrollmentRequestSchema = z.strictObject({ deviceId: protocolIdSchema, keys: devicePublicKeysSchema });
export const approvalSchema = z.strictObject({
  proof: deviceProofSchema,
  delivery: deviceDeliverySchema,
  history: deviceHistorySchema.optional(),
  authorization: deviceActionSchema,
});
export const bootstrapSchema = z.union([
  deviceProofSchema,
  z.strictObject({ primary: deviceProofSchema, recovery: approvalSchema }),
]);
export const revokeDeviceSchema = z.strictObject({ deviceId: protocolIdSchema, authorization: deviceActionSchema });
export const rotateDevicesSchema = z.strictObject({
  deliveries: z.array(deviceDeliverySchema).min(1).max(64),
  authorization: deviceActionSchema,
});
