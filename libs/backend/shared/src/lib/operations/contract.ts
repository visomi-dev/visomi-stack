import { z } from 'zod';

export const operationChannel = 'visomi:operations:v1';
export const operationIdInput = z.strictObject({ operationId: z.uuid() });
export const operationTicket = z.strictObject({ operationId: z.uuid(), expiresAt: z.iso.datetime() });
export const operationEvent = z.strictObject({
  operationId: z.uuid(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  // Completion delivers routing metadata only, never protected project content.
  result: z.strictObject({ jobId: z.uuid() }).optional(),
  error: z
    .strictObject({ code: z.string().regex(/^[a-z_]{1,80}$/), status: z.number().int().min(400).max(599) })
    .optional(),
});
export type OperationEvent = z.infer<typeof operationEvent>;
export type OperationOwner = { sessionId: string; userId: string; accountId: string; authVersion: number };
