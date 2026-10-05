import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { db } from '../db/client';
import { accountMemberships, accounts, notificationInbox, notificationPreferences, users } from '../db/schema';
import { subscribeToJson } from '../redis/pub-sub';

import { markNotificationRead, readNotifications, recordNotification, setNotificationPreferences } from './store';
import type { NotificationOwner } from './contract';
import { notificationChannel } from './contract';

jest.mock('../env', () => ({ env: { DATABASE_DRIVER: 'memory' } }));

beforeAll(async () => {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: resolve(__dirname, '../../../../../../drizzle') });
  await db.execute(sql.raw('CREATE ROLE notification_reader'));
  await db.execute(
    sql.raw('GRANT SELECT, INSERT, UPDATE ON notification_inbox, notification_preferences TO notification_reader'),
  );
}, 30000);
afterAll(async () => {
  await (db as unknown as { $client: PGlite }).$client.close();
});

async function identity(accountId?: string): Promise<NotificationOwner> {
  const owner = { userId: randomUUID(), accountId: accountId ?? randomUUID() };

  await db.insert(users).values({ id: owner.userId, email: `${owner.userId}@example.test` });
  if (!accountId)
    await db
      .insert(accounts)
      .values({ id: owner.accountId, ownerUserId: owner.userId, name: 'Workspace', slug: owner.accountId });
  await db.insert(accountMemberships).values({ id: randomUUID(), ...owner, role: 'owner' });

  return owner;
}

describe('account-scoped notification storage', () => {
  it('publishes hints only after committed state is visible and never after a denied producer', async () => {
    const owner = await identity();
    const id = randomUUID();
    const receive = jest.fn();
    const unsubscribe = await subscribeToJson(notificationChannel, receive);

    try {
      await recordNotification(owner, id, 'security');
      expect(receive).toHaveBeenCalledWith(owner);
      expect((await readNotifications(owner)).notifications[0]).toMatchObject({ id, kind: 'security' });
      await db.delete(accountMemberships).where(eq(accountMemberships.userId, owner.userId));
      await expect(recordNotification(owner, randomUUID(), 'service')).rejects.toMatchObject({ statusCode: 403 });
      await expect(setNotificationPreferences(owner, { servicePush: true })).rejects.toMatchObject({ statusCode: 403 });
      expect(receive).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
  it('persists and deduplicates generic notifications without exposing owner metadata', async () => {
    const owner = await identity();
    const id = randomUUID();

    await recordNotification(owner, id, 'service');
    await recordNotification(owner, id, 'service');
    const feed = await readNotifications(owner);

    expect(feed).toEqual({
      notifications: [{ id, kind: 'service', read: false, createdAt: expect.any(String) }],
      servicePush: false,
      pushAvailable: false,
    });
    await markNotificationRead(owner, id);
    await markNotificationRead(owner, id);
    expect((await readNotifications(owner)).notifications[0].read).toBe(true);
    await expect(recordNotification(owner, 'bad-id', 'service')).rejects.toThrow();
  });

  it('isolates inbox, preferences and read mutations across accounts and users in the same account', async () => {
    const owner = await identity();
    const other = await identity();
    const colleague = await identity(owner.accountId);
    const id = randomUUID();

    await recordNotification(owner, id, 'security');
    await setNotificationPreferences(owner, { servicePush: true });
    for (const foreign of [other, colleague]) {
      expect(await readNotifications(foreign)).toEqual({ notifications: [], servicePush: false, pushAvailable: false });
      await markNotificationRead(foreign, id);
      await setNotificationPreferences(foreign, { servicePush: false });
    }
    expect((await readNotifications(owner)).notifications[0].read).toBe(false);
    expect((await readNotifications(owner)).servicePush).toBe(true);
  });

  it('fails closed after membership removal and rejects unsupported preference fields', async () => {
    const owner = await identity();

    await expect(
      setNotificationPreferences(owner, { servicePush: true, familyPush: true } as { servicePush: boolean }),
    ).rejects.toThrow();
    await db.delete(accountMemberships).where(eq(accountMemberships.userId, owner.userId));
    await expect(readNotifications(owner)).rejects.toMatchObject({ statusCode: 403 });
    await expect(markNotificationRead(owner, randomUUID())).rejects.toMatchObject({ statusCode: 403 });
    await expect(setNotificationPreferences(owner, { servicePush: true })).rejects.toMatchObject({ statusCode: 403 });
    await expect(recordNotification(owner, randomUUID(), 'service')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('enforces both owner boundaries and write checks for a non-owner database role', async () => {
    const owner = await identity();
    const colleague = await identity(owner.accountId);
    const other = await identity();

    for (const target of [owner, colleague, other]) {
      await recordNotification(target, randomUUID(), 'service');
      await setNotificationPreferences(target, { servicePush: true });
    }
    const visible = await db.transaction(async (transaction) => {
      await transaction.execute(sql.raw('SET LOCAL ROLE notification_reader'));
      await transaction.execute(sql`SELECT set_config('app.current_account_id', ${owner.accountId}, true)`);
      await transaction.execute(sql`SELECT set_config('app.current_user_id', ${owner.userId}, true)`);
      const inbox = await transaction.select().from(notificationInbox);
      const preferences = await transaction.select().from(notificationPreferences);

      return { inbox, preferences };
    });

    expect(visible.inbox).toHaveLength(1);
    expect(visible.preferences).toHaveLength(1);
    expect(visible.inbox[0].userId).toBe(owner.userId);
    const unscoped = await db.transaction(async (transaction) => {
      await transaction.execute(sql.raw('SET LOCAL ROLE notification_reader'));

      return transaction.select().from(notificationInbox);
    });

    expect(unscoped).toHaveLength(0);
    await expect(
      db.transaction(async (transaction) => {
        await transaction.execute(sql.raw('SET LOCAL ROLE notification_reader'));
        await transaction.execute(sql`SELECT set_config('app.current_account_id', ${owner.accountId}, true)`);
        await transaction.execute(sql`SELECT set_config('app.current_user_id', ${owner.userId}, true)`);
        await transaction.insert(notificationInbox).values({ ...colleague, id: randomUUID(), kind: 'service' });
      }),
    ).rejects.toThrow();
    await expect(
      db.transaction(async (transaction) => {
        await transaction.execute(sql.raw('SET LOCAL ROLE notification_reader'));
        await transaction.execute(sql`SELECT set_config('app.current_account_id', ${owner.accountId}, true)`);
        await transaction.execute(sql`SELECT set_config('app.current_user_id', ${owner.userId}, true)`);
        await transaction
          .update(notificationPreferences)
          .set({ userId: colleague.userId })
          .where(eq(notificationPreferences.userId, owner.userId));
      }),
    ).rejects.toThrow();
    const foreignUpdates = await db.transaction(async (transaction) => {
      await transaction.execute(sql.raw('SET LOCAL ROLE notification_reader'));
      await transaction.execute(sql`SELECT set_config('app.current_account_id', ${owner.accountId}, true)`);
      await transaction.execute(sql`SELECT set_config('app.current_user_id', ${owner.userId}, true)`);

      return transaction
        .update(notificationPreferences)
        .set({ servicePush: false })
        .where(eq(notificationPreferences.userId, colleague.userId))
        .returning();
    });

    expect(foreignUpdates).toHaveLength(0);
    expect((await readNotifications(colleague)).servicePush).toBe(true);
  });

  it('bounds the newest-first feed to 100 notifications', async () => {
    const owner = await identity();
    const records = Array.from({ length: 101 }, (_, index) => ({
      ...owner,
      id: randomUUID(),
      kind: 'service' as const,
      createdAt: new Date(index * 1000),
    }));

    await db.insert(notificationInbox).values(records);
    const feed = await readNotifications(owner);

    expect(feed.notifications).toHaveLength(100);
    expect(feed.notifications[0].id).toBe(records[100].id);
    expect(feed.notifications.some(({ id }) => id === records[0].id)).toBe(false);
  });
});
