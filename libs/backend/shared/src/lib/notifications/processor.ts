import { createHash, randomUUID } from 'node:crypto';

import { and, eq, gt, inArray, lt, lte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { ZodError } from 'zod';

import { withAccountContext } from '../db/account-context';
import { db } from '../db/client';
import { notificationInbox, notificationPreferences, pushDeliveries, pushSubscriptions, users } from '../db/schema';
import type { SessionAuthorityStore } from '../session';
import { SessionAuthorityError } from '../session';
import { HttpError } from '../http';

import { deliverPush } from './push-transport';
import { pushSubscriptionInput } from './push-contract';
import type { PushDeliveryResult, VapidConfiguration } from './push-transport';
import { pushSessionBinding, requirePushMember, withPushAuthority } from './subscriptions';

export type PushDelivery = typeof pushDeliveries.$inferSelect;

/** Compare-and-swap leasing works in PostgreSQL and composed PGlite mode. */
export async function claimPushDelivery(): Promise<PushDelivery | null> {
  const now = DateTime.utc().toJSDate();
  const eligible = and(
    inArray(pushDeliveries.status, ['pending', 'running']),
    lte(pushDeliveries.availableAt, now),
    gt(pushDeliveries.expiresAt, now),
    lt(pushDeliveries.attempts, 3),
  );
  const [candidate] = await db.select().from(pushDeliveries).where(eligible).orderBy(pushDeliveries.createdAt).limit(1);

  if (!candidate) return null;
  const [claimed] = await db
    .update(pushDeliveries)
    .set({
      status: 'running',
      attempts: sql`${pushDeliveries.attempts} + 1`,
      lease: randomUUID(),
      availableAt: DateTime.utc().plus({ seconds: 30 }).toJSDate(),
    })
    .where(and(eligible, eq(pushDeliveries.id, candidate.id), eq(pushDeliveries.attempts, candidate.attempts)))
    .returning();

  return claimed ?? null;
}

export async function finishPushDelivery(delivery: PushDelivery, result: PushDeliveryResult): Promise<void> {
  if (!delivery.lease) throw new Error('Push delivery lease is required.');
  const retry = result === 'retry' && delivery.attempts < 3;

  await db
    .update(pushDeliveries)
    .set({
      status: retry ? 'pending' : 'finished',
      lease: null,
      availableAt: DateTime.utc()
        .plus({ seconds: delivery.attempts * 30 })
        .toJSDate(),
    })
    .where(
      and(
        eq(pushDeliveries.id, delivery.id),
        eq(pushDeliveries.status, 'running'),
        eq(pushDeliveries.lease, delivery.lease),
      ),
    );
}

/** Keep only one day of deduplication receipts; cleanup is bounded and never deletes live replacements. */
export async function expirePushDeliveries(): Promise<void> {
  const cutoff = DateTime.utc().minus({ days: 1 }).toJSDate();
  const rows = await db
    .select({ id: pushDeliveries.id })
    .from(pushDeliveries)
    .where(lte(pushDeliveries.expiresAt, cutoff))
    .orderBy(pushDeliveries.expiresAt)
    .limit(100);

  if (!rows.length) return;
  await db.delete(pushDeliveries).where(
    and(
      inArray(
        pushDeliveries.id,
        rows.map(({ id }) => id),
      ),
      lte(pushDeliveries.expiresAt, cutoff),
    ),
  );
}

/** Delivery rechecks session, membership, auth version, preference, revision and unread state. */
export async function processPushDelivery(
  delivery: PushDelivery,
  store: SessionAuthorityStore,
  configuration: VapidConfiguration,
): Promise<void> {
  const [subscription] = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.id, delivery.subscriptionId),
        eq(pushSubscriptions.accountId, delivery.accountId),
        eq(pushSubscriptions.userId, delivery.userId),
        eq(pushSubscriptions.revision, delivery.revision),
      ),
    );

  if (!subscription) return finishPushDelivery(delivery, 'rejected');
  const owner = {
    accountId: subscription.accountId,
    userId: subscription.userId,
    sessionId: subscription.sessionId,
    authVersion: subscription.authVersion,
  };
  let result: PushDeliveryResult;

  try {
    result = await withPushAuthority<PushDeliveryResult>(owner, store, async (authorityExpiry) =>
      withAccountContext(delivery, async (transaction): Promise<PushDeliveryResult> => {
        await requirePushMember(transaction, owner);
        const [live] = await transaction
          .select()
          .from(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.id, subscription.id),
              eq(pushSubscriptions.sessionBinding, pushSessionBinding(owner)),
              eq(pushSubscriptions.revision, delivery.revision),
              gt(pushSubscriptions.expiresAt, DateTime.utc().toJSDate()),
            ),
          )
          .for('share');
        const [preference] = await transaction
          .select()
          .from(notificationPreferences)
          .where(
            and(
              eq(notificationPreferences.accountId, delivery.accountId),
              eq(notificationPreferences.userId, delivery.userId),
            ),
          )
          .for('share');
        const [notification] = await transaction
          .select()
          .from(notificationInbox)
          .where(
            and(
              eq(notificationInbox.id, delivery.notificationId),
              eq(notificationInbox.accountId, delivery.accountId),
              eq(notificationInbox.userId, delivery.userId),
              eq(notificationInbox.read, false),
            ),
          )
          .for('share');
        const [lease] = await transaction
          .select()
          .from(pushDeliveries)
          .where(
            and(
              eq(pushDeliveries.id, delivery.id),
              eq(pushDeliveries.lease, delivery.lease ?? ''),
              eq(pushDeliveries.status, 'running'),
              gt(pushDeliveries.expiresAt, DateTime.utc().toJSDate()),
            ),
          )
          .for('share');

        if (!live || !preference?.servicePush || !notification || !lease) return 'rejected';
        const parsed = pushSubscriptionInput.safeParse(live.subscription);

        if (!parsed.success || createHash('sha256').update(parsed.data.endpoint).digest('hex') !== live.endpointHash)
          return 'rejected';

        const [user] = await transaction
          .select({ preferences: users.preferences })
          .from(users)
          .where(eq(users.id, owner.userId))
          .for('share');
        const locale = user?.preferences?.locale === 'es' ? 'es' : 'en';
        const remaining =
          Math.min(authorityExpiry.getTime(), live.expiresAt.getTime(), lease.expiresAt.getTime()) -
          DateTime.utc().toMillis();

        if (remaining <= 0) return 'rejected';

        return deliverPush(
          parsed.data,
          configuration,
          AbortSignal.timeout(Math.ceil(Math.min(5000, remaining))),
          locale,
        );
      }),
    );
  } catch (error) {
    // Invalid authority is permanent; transient storage outages retry without sending.
    // Neither path retains or logs session/provider material.
    result =
      error instanceof SessionAuthorityError || error instanceof HttpError || error instanceof ZodError
        ? 'rejected'
        : 'retry';
  }
  if (result === 'expired') {
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.id, subscription.id), eq(pushSubscriptions.revision, delivery.revision)));
  }
  await finishPushDelivery(delivery, result);
}
