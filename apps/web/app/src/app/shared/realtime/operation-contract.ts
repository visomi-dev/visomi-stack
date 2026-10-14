import * as z from 'zod/mini';

// Browser contracts intentionally do not import the backend runtime entry point.
export const operationTicketSchema = z.strictObject({ operationId: z.uuid(), expiresAt: z.iso.datetime() });
export const operationEventSchema = z.strictObject({
  operationId: z.uuid(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  result: z.optional(z.strictObject({ jobId: z.uuid() })),
  error: z.optional(
    z.strictObject({
      code: z.string().check(z.regex(/^[a-z_]{1,80}$/)),
      status: z.int().check(z.minimum(400), z.maximum(599)),
    }),
  ),
});
export type OperationTicket = z.infer<typeof operationTicketSchema>;
export type OperationEvent = z.infer<typeof operationEventSchema>;
