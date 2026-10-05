import { z } from 'zod';

export const notificationKind = z.enum(['service', 'security']);
export const notificationSummary = z.strictObject({
  id: z.uuid(),
  kind: notificationKind,
  read: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const notificationPreferenceInput = z.strictObject({ servicePush: z.boolean() });
export const notificationChannel = 'visomi:notifications:v1';
export const notificationHint = z.strictObject({ accountId: z.uuid(), userId: z.uuid() });
export const notificationFeed = z.strictObject({
  notifications: z.array(notificationSummary).max(100),
  servicePush: z.boolean(),
  pushAvailable: z.boolean(),
});
export const pushCapabilities = z.strictObject({
  available: z.boolean(),
  publicKey: z.string().nullable(),
  registered: z.boolean(),
});
export type NotificationKind = z.infer<typeof notificationKind>;
export type NotificationOwner = { accountId: string; userId: string };
