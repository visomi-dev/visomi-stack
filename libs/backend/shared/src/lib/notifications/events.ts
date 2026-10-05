import { publishJson } from '../redis/pub-sub';

import { notificationChannel, notificationHint } from './contract';
import type { NotificationOwner } from './contract';

/** Call only after commit. Pub/sub is an invalidation hint, never the inbox authority. */
export async function publishNotificationHint(owner: NotificationOwner): Promise<void> {
  const hint = notificationHint.parse({ accountId: owner.accountId, userId: owner.userId });

  await publishJson(notificationChannel, hint).catch(() => undefined);
}
