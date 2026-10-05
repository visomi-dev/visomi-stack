import { createHash, createHmac, randomUUID } from 'node:crypto';

import { and, count, eq, inArray, lte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { withAccountContext } from '../db/account-context';
import { db } from '../db/client';
import { accountMemberships, pushSubscriptions, users } from '../db/schema';
import { env } from '../env';
import { HttpError } from '../http';
import type { SessionAuthorityStore } from '../session';

import { pushSubscriptionInput } from './push-contract';
import type { PushSubscriptionInput } from './push-contract';

const pushOwner = z.strictObject({
  accountId: z.uuid(),
  userId: z.uuid(),
  sessionId: z.string().min(1).max(256),
  authVersion: z.int().positive(),
});

export type PushOwner = z.infer<typeof pushOwner>;
const persistedSession = z.object({
  authority: z.literal('full'),
  passport: z.object({ user: z.object({ id: z.uuid(), accountId: z.uuid(), authVersion: z.int().positive() }) }),
  cookie: z.object({ expires: z.union([z.date(), z.iso.datetime()]) }),
});

/** Capability is session/account scoped and contains no endpoint, key material or raw SID. */
export async function hasPushSubscription(owner: PushOwner, store: SessionAuthorityStore): Promise<boolean> {
  return withPushAuthority(owner, store, async () =>
    withAccountContext(owner, async (transaction) => {
      await requirePushMember(transaction, owner);
      const [subscription] = await transaction
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.accountId, owner.accountId),
            eq(pushSubscriptions.userId, owner.userId),
            eq(pushSubscriptions.sessionBinding, pushSessionBinding(owner)),
            eq(pushSubscriptions.authVersion, owner.authVersion),
            sql`${pushSubscriptions.expiresAt} > ${DateTime.utc().toJSDate()}`,
          ),
        )
        .limit(1);

      return Boolean(subscription);
    }),
  );
}

export function pushSessionBinding(owner: PushOwner): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(
      JSON.stringify(['visomi-push-session-v1', owner.sessionId, owner.accountId, owner.userId, owner.authVersion]),
    )
    .digest('hex');
}

/** Registration and future delivery must hold the same live session-authority lease. */
export async function withPushAuthority<T>(
  owner: PushOwner,
  store: SessionAuthorityStore,
  run: (expiresAt: Date) => Promise<T>,
): Promise<T> {
  pushOwner.parse(owner);

  return store.withSessionAuthority(
    { userId: owner.userId, authVersion: owner.authVersion, currentSid: owner.sessionId, authority: 'full' },
    async () => {
      const session = persistedSession.parse(
        await new Promise<unknown>((resolve, reject) =>
          store.get(owner.sessionId, (error, value) => (error ? reject(error) : resolve(value))),
        ),
      );
      const user = session.passport.user;
      const expiry =
        session.cookie.expires instanceof Date
          ? DateTime.fromJSDate(session.cookie.expires, { zone: 'utc' })
          : DateTime.fromISO(session.cookie.expires, { zone: 'utc' });

      if (
        user.id !== owner.userId ||
        user.accountId !== owner.accountId ||
        user.authVersion !== owner.authVersion ||
        !expiry.isValid ||
        expiry.toMillis() <= DateTime.utc().toMillis()
      )
        throw denied();

      return run(DateTime.min(expiry, DateTime.utc().plus({ days: 7 })).toJSDate());
    },
  );
}

function denied(): HttpError {
  return new HttpError({ code: 'push_access_denied', message: 'Push registration is unavailable.', statusCode: 403 });
}

export async function requirePushMember(
  transaction: Parameters<Parameters<typeof withAccountContext>[1]>[0],
  owner: PushOwner,
): Promise<void> {
  const [member] = await transaction
    .select({ authVersion: users.authVersion })
    .from(accountMemberships)
    .innerJoin(users, eq(users.id, accountMemberships.userId))
    .where(and(eq(accountMemberships.accountId, owner.accountId), eq(accountMemberships.userId, owner.userId)))
    .for('share');

  if (member?.authVersion !== owner.authVersion) throw denied();
}

/** Opt-in registration with live authority. Never permit a foreign endpoint takeover. */
export async function registerPushSubscription(
  owner: PushOwner,
  input: PushSubscriptionInput,
  store: SessionAuthorityStore,
): Promise<void> {
  const subscription = pushSubscriptionInput.parse(input);
  const binding = pushSessionBinding(owner);

  try {
    await withPushAuthority(owner, store, async (expiresAt) =>
      withAccountContext(owner, async (transaction) => {
        await requirePushMember(transaction, owner);
        await transaction
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.accountId, owner.accountId),
              eq(pushSubscriptions.userId, owner.userId),
              lte(pushSubscriptions.expiresAt, DateTime.utc().toJSDate()),
            ),
          );
        const [existing] = await transaction
          .select({ id: pushSubscriptions.id })
          .from(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.accountId, owner.accountId),
              eq(pushSubscriptions.userId, owner.userId),
              eq(pushSubscriptions.sessionBinding, binding),
            ),
          );
        const [total] = await transaction
          .select({ value: count() })
          .from(pushSubscriptions)
          .where(and(eq(pushSubscriptions.accountId, owner.accountId), eq(pushSubscriptions.userId, owner.userId)));

        if (!existing && total.value >= 8)
          throw new HttpError({
            code: 'push_capacity_exceeded',
            message: 'Remove an existing device registration first.',
            statusCode: 409,
          });
        await transaction
          .insert(pushSubscriptions)
          .values({
            ...owner,
            id: randomUUID(),
            sessionBinding: binding,
            endpointHash: createHash('sha256').update(subscription.endpoint).digest('hex'),
            subscription,
            expiresAt,
          })
          .onConflictDoUpdate({
            target: [pushSubscriptions.accountId, pushSubscriptions.userId, pushSubscriptions.sessionBinding],
            set: {
              subscription,
              endpointHash: createHash('sha256').update(subscription.endpoint).digest('hex'),
              expiresAt,
              revision: sql`${pushSubscriptions.revision} + 1`,
              updatedAt: DateTime.utc().toJSDate(),
            },
          });
      }),
    );
  } catch (error) {
    // Some drivers wrap PostgreSQL errors in a cause. Do not expose endpoint hashes or keys in diagnostics.
    const cause = error instanceof Error && 'cause' in error && error.cause ? error.cause : error;

    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505') {
      throw new HttpError({
        code: 'push_registration_conflict',
        message: 'This device registration is unavailable.',
        statusCode: 409,
      });
    }
    throw error;
  }
}

/** Scoped, idempotent removal. Does not disclose registrations belonging to other sessions or accounts. */
export async function removePushSubscription(owner: PushOwner, store: SessionAuthorityStore): Promise<void> {
  await withPushAuthority(owner, store, async () =>
    withAccountContext(owner, async (transaction) => {
      await requirePushMember(transaction, owner);
      await transaction
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.accountId, owner.accountId),
            eq(pushSubscriptions.userId, owner.userId),
            eq(pushSubscriptions.sessionBinding, pushSessionBinding(owner)),
          ),
        );
    }),
  );
}

/** Trusted store cleanup only: never accept a SID from a public request body. */
export async function revokeSessionPushSubscriptions(sessionId: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.sessionId, sessionId));
}

export async function expirePushSubscriptions(): Promise<void> {
  const now = DateTime.utc().toJSDate();
  const expired = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(lte(pushSubscriptions.expiresAt, now))
    .orderBy(pushSubscriptions.expiresAt)
    .limit(100);

  if (!expired.length) return;
  // Recheck expiry so a concurrent replacement between discovery and deletion survives.
  await db.delete(pushSubscriptions).where(
    and(
      inArray(
        pushSubscriptions.id,
        expired.map(({ id }) => id),
      ),
      lte(pushSubscriptions.expiresAt, now),
    ),
  );
}
