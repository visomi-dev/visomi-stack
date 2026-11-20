import { z } from 'zod';

export const targetSchema = z.strictObject({ tenantId: z.uuid(), scopeId: z.uuid() });
export const roleSchema = z.enum(['viewer', 'editor', 'manager', 'blocked']);
export const scopeInputSchema = z.strictObject({
  kind: z.enum(['group', 'resource']),
  objectBackup: z.literal(true).optional(),
});
export const memberInputSchema = z.strictObject({ userId: z.uuid(), active: z.boolean() });
export const grantInputSchema = z.strictObject({ userId: z.uuid(), role: roleSchema });
export type AccessTarget = z.infer<typeof targetSchema>;
export type ScopeRole = z.infer<typeof roleSchema>;
