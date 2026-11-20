import { z } from 'zod';

import { dataEnvelopeSchema, encodedBytes, serializeDataEnvelope, type DataEnvelope } from './crypto-contract';
import { deviceActionSchema } from './device-contract';
import { operationIdSchema } from './operations';

export const syncHeadSchema = z
  .strictObject({ cursor: z.number().int().min(0).max(2_147_483_647), checkpoint: encodedBytes(32).nullable() })
  .refine((value) => (value.cursor === 0) === (value.checkpoint === null));
export type SyncHead = z.infer<typeof syncHeadSchema>;
export const syncReadSchema = z.strictObject({
  protocol: z.literal(1),
  head: syncHeadSchema,
  limit: z.number().int().min(1).max(100).default(25),
  authorization: deviceActionSchema.optional(),
});

/** Distinguishes a pull from a write and binds the existing signed sync action to the verified session. */
export function syncReadBody(input: { protocol: 1; head: SyncHead; limit: number }, csrf: string) {
  return ['pull', input.protocol, input.head.cursor, input.head.checkpoint, input.limit, csrf];
}

/** Bind a notification subscription to its session using the existing signed sync action. */
export function syncWatchBody(csrf: string) {
  return ['watch', 1, csrf];
}
export const syncWriteSchema = z.strictObject({
  protocol: z.literal(1),
  operationId: operationIdSchema,
  expectedRevision: z.number().int().min(0).max(2_147_483_646),
  head: syncHeadSchema,
  envelope: dataEnvelopeSchema,
  authorization: deviceActionSchema,
});
export const syncEventSchema = z.strictObject({
  cursor: z.number().int().positive().max(2_147_483_647),
  checkpoint: encodedBytes(32),
  previousCheckpoint: encodedBytes(32).nullable(),
  envelope: dataEnvelopeSchema,
});
export type SyncEvent = z.infer<typeof syncEventSchema>;
export const syncPageSchema = z.strictObject({
  protocol: z.literal(1),
  generation: z.number().int().positive(),
  epoch: z.number().int().positive(),
  phase: z.enum(['ready', 'rotating']),
  head: syncHeadSchema,
  events: z.array(syncEventSchema).max(100),
  more: z.boolean(),
});
export type SyncPage = z.infer<typeof syncPageSchema>;

/** Hash input only. Runtime adapters supply SHA-256; an unkeyed hash alone is not authenticity. */
export function syncCheckpointMessage(cursor: number, previous: string | null, envelope: DataEnvelope): string {
  return JSON.stringify(['visomi.sync-checkpoint', 1, cursor, previous, serializeDataEnvelope(envelope)]);
}
