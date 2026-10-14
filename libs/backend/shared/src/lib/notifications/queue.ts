import { randomUUID } from 'node:crypto';

import { and, eq, gt } from 'drizzle-orm';
import { DateTime } from 'luxon';

import type { withAccountContext } from '../db/account-context';
import { notificationPreferences, pushDeliveries, pushSubscriptions } from '../db/schema';

import type { NotificationOwner } from './contract';

type NotificationTransaction = Parameters<Parameters<typeof withAccountContext>[1]>[0];

/** Called only in the notification producer's transaction: no detached Redis enqueue. */
export async function enqueueNotificationPush(
  transaction: NotificationTransaction,
  owner: NotificationOwner,
  notificationId: string,
): Promise<void> {
  const [preference] = await transaction
    .select()
    .from(notificationPreferences)
    .where(
      and(eq(notificationPreferences.accountId, owner.accountId), eq(notificationPreferences.userId, owner.userId)),
    );

  if (!preference?.servicePush) return;
  const subscriptions = await transaction
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.accountId, owner.accountId),
        eq(pushSubscriptions.userId, owner.userId),
        gt(pushSubscriptions.expiresAt, DateTime.utc().toJSDate()),
      ),
    )
    .orderBy(pushSubscriptions.id)
    .limit(8);

  for (const subscription of subscriptions) {
    await transaction
      .insert(pushDeliveries)
      .values({
        accountId: owner.accountId,
        userId: owner.userId,
        id: randomUUID(),
        notificationId,
        subscriptionId: subscription.id,
        revision: subscription.revision,
        expiresAt: DateTime.min(
          DateTime.fromJSDate(subscription.expiresAt, { zone: 'utc' }),
          DateTime.utc().plus({ minutes: 10 }),
        ).toJSDate(),
      })
      .onConflictDoNothing();
  }
}
