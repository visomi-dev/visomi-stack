import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePostgres } from 'drizzle-orm/node-postgres/migrator';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { Cookie } from 'express-session';
import type { SessionData } from 'express-session';
import { DateTime } from 'luxon';

import { db } from '../db/client';
import { withAccountContext } from '../db/account-context';
import { getPool } from '../db/pool';
import {
  accountMemberships,
  accounts,
  notificationInbox,
  pushDeliveries,
  pushSubscriptions,
  users,
} from '../db/schema';
import { ManagedMemorySessionStore, PostgresSessionStore } from '../session';

import { claimPushDelivery, expirePushDeliveries, finishPushDelivery, processPushDelivery } from './processor';
import { deliverPush } from './push-transport';
import { enqueueNotificationPush } from './queue';
import { markNotificationRead, recordNotification, setNotificationPreferences } from './store';
import { registerPushSubscription, revokeSessionPushSubscriptions } from './subscriptions';
import type { PushOwner } from './subscriptions';

jest.mock('../env', () => ({
  env: {
    DATABASE_DRIVER: process.env.PUSH_DELIVERY_TEST_DATABASE_URL ? 'pg' : 'memory',
    DATABASE_URL: process.env.PUSH_DELIVERY_TEST_DATABASE_URL,
    DATABASE_SSL: false,
    SESSION_SECRET: 'isolated-push-delivery-secret',
  },
}));
jest.mock('./push-transport', () => ({ deliverPush: jest.fn().mockResolvedValue('sent') }));
jest.mock('./events', () => ({ publishNotificationHint: jest.fn().mockResolvedValue(undefined) }));

const vapid = {
  publicKey: 'unused-test-public',
  privateKey: 'unused-test-private',
  subject: 'mailto:push@example.test',
};
const send = jest.mocked(deliverPush);

beforeAll(async () => {
  const options = { migrationsFolder: resolve(__dirname, '../../../../../../drizzle') };

  if (process.env.PUSH_DELIVERY_TEST_DATABASE_URL) {
    const url = new URL(process.env.PUSH_DELIVERY_TEST_DATABASE_URL);

    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/themis_api_e2e')
      throw new Error('Push delivery verification requires a disposable loopback E2E database.');
    await migratePostgres(db as unknown as NodePgDatabase, options);
  } else await migrate(db as unknown as PgliteDatabase, options);
}, 30000);
beforeEach(async () => {
  send.mockReset().mockResolvedValue('sent');
  await db.delete(pushDeliveries);
});
afterAll(async () => {
  if (process.env.PUSH_DELIVERY_TEST_DATABASE_URL) await getPool().end();
  else await (db as unknown as { $client: PGlite }).$client.close();
});

function subscription() {
  const key = createECDH('prime256v1');

  key.generateKeys();

  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

async function fixture(preference = true) {
  const owner: PushOwner = { accountId: randomUUID(), userId: randomUUID(), sessionId: randomUUID(), authVersion: 1 };
  const store = process.env.PUSH_DELIVERY_TEST_DATABASE_URL
    ? new PostgresSessionStore(getPool(), 'user_sessions', getPool())
    : new ManagedMemorySessionStore(revokeSessionPushSubscriptions);
  const cookie = new Cookie();

  cookie.maxAge = 60_000;
  const session = {
    cookie,
    authority: 'full',
    passport: { user: { id: owner.userId, accountId: owner.accountId, authVersion: 1 } },
  } as SessionData;

  await db.insert(users).values({ id: owner.userId, email: `${owner.userId}@example.test` });
  await db
    .insert(accounts)
    .values({ id: owner.accountId, ownerUserId: owner.userId, name: 'Push test', slug: owner.accountId });
  await db
    .insert(accountMemberships)
    .values({ id: randomUUID(), accountId: owner.accountId, userId: owner.userId, role: 'owner' });
  await new Promise<void>((resolve, reject) =>
    store.set(owner.sessionId, session, (error) => (error ? reject(error) : resolve())),
  );
  await registerPushSubscription(owner, subscription(), store);
  await setNotificationPreferences(owner, { servicePush: preference });
  const notificationId = randomUUID();

  await recordNotification(owner, notificationId, 'service');

  return { owner, store, notificationId };
}

describe('durable bounded push outbox', () => {
  it('rolls back delivery with its producer and never inherits operation status or lease fields', async () => {
    const { owner } = await fixture(false);

    await setNotificationPreferences(owner, { servicePush: true });
    const id = randomUUID();
    const operationOwner = { ...owner, status: 'running', attempts: 2, lease: 'foreign-operation-lease' };

    await expect(
      withAccountContext(owner, async (transaction) => {
        await transaction.insert(notificationInbox).values({ ...owner, id, kind: 'service' });
        await enqueueNotificationPush(transaction, operationOwner, id);
        const [row] = await transaction.select().from(pushDeliveries);

        expect(row).toMatchObject({ status: 'pending', attempts: 0, lease: null });
        throw new Error('Producer rollback');
      }),
    ).rejects.toThrow('Producer rollback');
    expect(await db.select().from(pushDeliveries)).toHaveLength(0);
    expect(await db.select().from(notificationInbox).where(eq(notificationInbox.id, id))).toHaveLength(0);
  });

  it('enqueues atomically once per event/device and does not retroactively alert after opt-in', async () => {
    const { owner, notificationId } = await fixture(false);

    expect(await claimPushDelivery()).toBeNull();
    await setNotificationPreferences(owner, { servicePush: true });
    await recordNotification(owner, notificationId, 'service');
    expect(await claimPushDelivery()).toBeNull();
    const id = randomUUID();

    await recordNotification(owner, id, 'service');
    await recordNotification(owner, id, 'service');
    expect(await db.select().from(pushDeliveries)).toHaveLength(1);
  });

  it('leases one winner, sends using live authority and rejects stale completion', async () => {
    const { store } = await fixture();
    const first = await claimPushDelivery();

    expect(first?.attempts).toBe(1);
    expect(await claimPushDelivery()).toBeNull();
    await processPushDelivery(first!, store, vapid);
    expect(send).toHaveBeenCalledTimes(1);
    await finishPushDelivery({ ...first!, lease: randomUUID() }, 'retry');
    expect((await db.select().from(pushDeliveries))[0].status).toBe('finished');
  });

  it('reclaims an abandoned lease and caps transient retries at three attempts', async () => {
    const { store } = await fixture();
    const first = await claimPushDelivery();

    await db.update(pushDeliveries).set({ availableAt: DateTime.utc().minus({ seconds: 1 }).toJSDate() });
    const second = await claimPushDelivery();

    expect(second?.attempts).toBe(2);
    expect(second?.lease).not.toBe(first?.lease);
    await finishPushDelivery(first!, 'sent');
    expect((await db.select().from(pushDeliveries))[0].lease).toBe(second?.lease);
    send.mockResolvedValue('retry');
    await processPushDelivery(second!, store, vapid);
    await db.update(pushDeliveries).set({ availableAt: DateTime.utc().minus({ seconds: 1 }).toJSDate() });
    const third = await claimPushDelivery();

    await processPushDelivery(third!, store, vapid);
    expect((await db.select().from(pushDeliveries))[0]).toMatchObject({ status: 'finished', attempts: 3 });
    expect(await claimPushDelivery()).toBeNull();
  });

  it.each([
    'preference',
    'read',
    'revision',
    'auth-version',
    'expiry',
    'session',
    'membership',
    'binding',
    'endpoint-hash',
    'stored-key',
  ])('does not send after %s revocation between enqueue and delivery', async (change) => {
    const { owner, store, notificationId } = await fixture();
    const delivery = await claimPushDelivery();

    if (change === 'preference') await setNotificationPreferences(owner, { servicePush: false });
    if (change === 'read') await markNotificationRead(owner, notificationId);
    if (change === 'revision') await registerPushSubscription(owner, subscription(), store);
    if (change === 'auth-version') await db.update(users).set({ authVersion: 2 }).where(eq(users.id, owner.userId));
    if (change === 'expiry')
      await db.update(pushDeliveries).set({ expiresAt: DateTime.utc().minus({ seconds: 1 }).toJSDate() });
    if (change === 'session')
      await new Promise<void>((resolve, reject) =>
        store.destroy(owner.sessionId, (error) => (error ? reject(error) : resolve())),
      );
    if (change === 'membership') await db.delete(accountMemberships).where(eq(accountMemberships.userId, owner.userId));
    if (change === 'binding')
      await db
        .update(pushSubscriptions)
        .set({ sessionBinding: 'tampered-binding' })
        .where(eq(pushSubscriptions.userId, owner.userId));
    if (change === 'endpoint-hash')
      await db
        .update(pushSubscriptions)
        .set({ endpointHash: 'tampered-hash' })
        .where(eq(pushSubscriptions.userId, owner.userId));
    if (change === 'stored-key')
      await db
        .update(pushSubscriptions)
        .set({ subscription: { ...subscription(), keys: { p256dh: 'invalid', auth: 'invalid' } } })
        .where(eq(pushSubscriptions.userId, owner.userId));
    await processPushDelivery(delivery!, store, vapid);
    expect(send).not.toHaveBeenCalled();
  });

  it('removes an expired provider registration and cascades its delivery receipts', async () => {
    const { owner, store } = await fixture();
    const delivery = await claimPushDelivery();

    send.mockResolvedValue('expired');
    await processPushDelivery(delivery!, store, vapid);
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, owner.userId))).toHaveLength(0);
    expect(await db.select().from(pushDeliveries)).toHaveLength(0);
  });

  it('cleans expired deduplication receipts in batches while retaining active work', async () => {
    await fixture();
    const [delivery] = await db.select().from(pushDeliveries);

    await db
      .update(pushDeliveries)
      .set({ expiresAt: DateTime.utc().minus({ days: 2 }).toJSDate() })
      .where(eq(pushDeliveries.id, delivery.id));
    await expirePushDeliveries();
    expect(await db.select().from(pushDeliveries)).toHaveLength(0);
    await fixture();
    await expirePushDeliveries();
    expect(await db.select().from(pushDeliveries)).toHaveLength(1);
  });

  it('holds the session lease through the bounded send so revocation cannot overtake it', async () => {
    const { owner, store } = await fixture();
    const delivery = await claimPushDelivery();
    let announce: () => void = () => undefined;
    let release: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const sending = new Promise<void>((resolve) => {
      release = resolve;
    });

    send.mockImplementation(async () => {
      announce();
      await sending;

      return 'sent';
    });
    const running = processPushDelivery(delivery!, store, vapid);

    await entered;
    let revoked = false;
    const revocation = new Promise<void>((resolve, reject) =>
      store.destroy(owner.sessionId, (error) => {
        if (error) reject(error);
        else {
          revoked = true;
          resolve();
        }
      }),
    );

    try {
      await Promise.resolve();
      expect(revoked).toBe(false);
    } finally {
      release();
    }
    await Promise.all([running, revocation]);
    expect(revoked).toBe(true);
    expect(await db.select().from(pushDeliveries)).toHaveLength(0);
  });

  it('enforces tenant RLS for infrastructure-discovered delivery rows', async () => {
    const { owner } = await fixture();

    await db.execute(sql.raw('CREATE ROLE push_delivery_reader'));
    await db.execute(sql.raw('GRANT SELECT ON push_deliveries TO push_delivery_reader'));
    await db.transaction(async (transaction) => {
      await transaction.execute(sql.raw('SET LOCAL ROLE push_delivery_reader'));
      expect(await transaction.select().from(pushDeliveries)).toHaveLength(0);
      await transaction.execute(sql`select set_config('app.current_account_id', ${owner.accountId}, true)`);
      await transaction.execute(sql`select set_config('app.current_user_id', ${owner.userId}, true)`);
      expect(await transaction.select().from(pushDeliveries)).toHaveLength(1);
    });
  });
});
