import { and, desc, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { withAccountContext } from '../db/account-context';
import { accountMemberships, notificationInbox, notificationPreferences } from '../db/schema';
import { HttpError } from '../http';

import { notificationFeed, notificationKind, notificationPreferenceInput, notificationSummary } from './contract';
import type { NotificationKind, NotificationOwner } from './contract';
import { publishNotificationHint } from './events';
import { enqueueNotificationPush } from './queue';
import { readPushConfiguration } from './push-configuration';

type NotificationDb = Parameters<Parameters<typeof withAccountContext>[1]>[0];

async function requireMember(transaction: NotificationDb, owner: NotificationOwner): Promise<void> {
  const [membership] = await transaction
    .select({ id: accountMemberships.id })
    .from(accountMemberships)
    .where(and(eq(accountMemberships.accountId, owner.accountId), eq(accountMemberships.userId, owner.userId)));

  if (!membership)
    throw new HttpError({
      code: 'notification_access_denied',
      message: 'Notifications are unavailable.',
      statusCode: 403,
    });
}

/** Trusted producers supply an idempotent event ID; content and navigation payloads are not accepted. */
export async function recordNotification(owner: NotificationOwner, id: string, kind: NotificationKind): Promise<void> {
  notificationSummary.shape.id.parse(id);
  notificationKind.parse(kind);
  await withAccountContext(owner, async (transaction) => {
    await requireMember(transaction, owner);
    const [inserted] = await transaction
      .insert(notificationInbox)
      .values({ ...owner, id, kind })
      .onConflictDoNothing()
      .returning();

    if (inserted) await enqueueNotificationPush(transaction, owner, id);
  });
  await publishNotificationHint(owner);
}

export async function readNotifications(owner: NotificationOwner) {
  return withAccountContext(owner, async (transaction) => {
    await requireMember(transaction, owner);
    const notifications = await transaction
      .select()
      .from(notificationInbox)
      .where(and(eq(notificationInbox.accountId, owner.accountId), eq(notificationInbox.userId, owner.userId)))
      .orderBy(desc(notificationInbox.createdAt), desc(notificationInbox.id))
      .limit(100);
    const [preferences] = await transaction
      .select()
      .from(notificationPreferences)
      .where(
        and(eq(notificationPreferences.accountId, owner.accountId), eq(notificationPreferences.userId, owner.userId)),
      );

    return notificationFeed.parse({
      notifications: notifications.map(({ id, kind, read, createdAt }) => ({
        id,
        kind,
        read,
        createdAt: DateTime.fromJSDate(createdAt, { zone: 'utc' }).toISO(),
      })),
      servicePush: preferences?.servicePush ?? false,
      pushAvailable: Boolean(readPushConfiguration()),
    });
  });
}

export async function setNotificationPreferences(
  owner: NotificationOwner,
  input: { servicePush: boolean },
): Promise<void> {
  const preferences = notificationPreferenceInput.parse(input);

  await withAccountContext(owner, async (transaction) => {
    await requireMember(transaction, owner);
    await transaction
      .insert(notificationPreferences)
      .values({ ...owner, ...preferences })
      .onConflictDoUpdate({
        target: [notificationPreferences.accountId, notificationPreferences.userId],
        set: preferences,
      });
  });
  await publishNotificationHint(owner);
}

export async function markNotificationRead(owner: NotificationOwner, id: string): Promise<void> {
  await withAccountContext(owner, async (transaction) => {
    await requireMember(transaction, owner);
    await transaction
      .update(notificationInbox)
      .set({ read: true })
      .where(
        and(
          eq(notificationInbox.accountId, owner.accountId),
          eq(notificationInbox.userId, owner.userId),
          eq(notificationInbox.id, id),
        ),
      );
  });
  await publishNotificationHint(owner);
}
