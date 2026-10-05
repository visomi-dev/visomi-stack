import * as z from 'zod/mini';

export const notificationSummary = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['service', 'security']),
  read: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const notificationEnvelope = z.object({
  data: z.strictObject({
    notifications: z.array(notificationSummary).check(z.maxLength(100)),
    servicePush: z.boolean(),
    pushAvailable: z.boolean(),
  }),
});
export type NotificationSummary = z.infer<typeof notificationSummary>;
