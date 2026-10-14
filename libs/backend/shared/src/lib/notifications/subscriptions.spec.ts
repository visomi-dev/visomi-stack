import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { Cookie } from 'express-session';
import type { SessionData } from 'express-session';
import { DateTime } from 'luxon';

import { db } from '../db/client';
import { accountMemberships, accounts, pushSubscriptions, userSessions, users } from '../db/schema';
import { ManagedMemorySessionStore } from '../session';

import {
  expirePushSubscriptions,
  registerPushSubscription,
  removePushSubscription,
  revokeSessionPushSubscriptions,
} from './subscriptions';
import type { PushOwner } from './subscriptions';

jest.mock('../env', () => ({ env: { DATABASE_DRIVER: 'memory', SESSION_SECRET: 'isolated-push-test-secret' } }));

beforeAll(async () => {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: resolve(__dirname, '../../../../../../drizzle') });
  await db.execute(sql.raw('CREATE ROLE push_reader'));
  await db.execute(sql.raw('GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO push_reader'));
}, 30000);
afterAll(async () => {
  await (db as unknown as { $client: PGlite }).$client.close();
});

function subscription(endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`) {
  const key = createECDH('prime256v1');

  key.generateKeys();

  return {
    endpoint,
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

function payload(owner: PushOwner, authority = 'full'): SessionData {
  const cookie = new Cookie();

  cookie.maxAge = 60_000;

  return {
    cookie,
    ...{
      authority,
      passport: { user: { id: owner.userId, accountId: owner.accountId, authVersion: owner.authVersion } },
    },
  };
}

async function save(store: ManagedMemorySessionStore, owner: PushOwner, data = payload(owner)): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    store.set(owner.sessionId, data, (error) => (error ? reject(error) : resolve())),
  );
}

async function fixture() {
  const owner = { accountId: randomUUID(), userId: randomUUID(), sessionId: randomUUID(), authVersion: 1 };
  const store = new ManagedMemorySessionStore(revokeSessionPushSubscriptions);

  await db.insert(users).values({ id: owner.userId, email: `${owner.userId}@example.test` });
  await db
    .insert(accounts)
    .values({ id: owner.accountId, ownerUserId: owner.userId, name: 'Push fixture', slug: owner.accountId });
  await db
    .insert(accountMemberships)
    .values({ id: randomUUID(), accountId: owner.accountId, userId: owner.userId, role: 'owner' });
  await save(store, owner);

  return { owner, store };
}

async function rows(owner: PushOwner) {
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, owner.userId));
}

describe('session-bound push registration storage', () => {
  it('validates browser keys, replaces one scoped registration and bounds expiry to the live session', async () => {
    const { owner, store } = await fixture();
    const input = subscription();

    await registerPushSubscription(owner, input, store);
    const [first] = await rows(owner);

    expect(first.subscription).toEqual(input);
    expect(first.sessionBinding).not.toContain(owner.sessionId);
    expect(first.expiresAt.getTime()).toBeLessThanOrEqual(DateTime.utc().plus({ minutes: 1 }).toMillis());
    await registerPushSubscription(owner, subscription(), store);
    const [replaced] = await rows(owner);

    expect(replaced.id).toBe(first.id);
    expect(replaced.revision).toBe(2);
    expect(replaced.subscription.endpoint).not.toBe(input.endpoint);
    expect(await rows(owner)).toHaveLength(1);
    await expect(
      registerPushSubscription(owner, { ...input, endpoint: 'https://127.0.0.1/push' }, store),
    ).rejects.toThrow();
    expect((await rows(owner))[0].revision).toBe(2);
  });

  it('prevents endpoint takeover by another session or owner instead of silently rebinding delivery', async () => {
    const { owner, store } = await fixture();
    const input = subscription();
    const other = await fixture();
    const peer = { ...owner, sessionId: randomUUID() };

    await save(store, peer);
    await registerPushSubscription(owner, input, store);
    await expect(registerPushSubscription(peer, input, store)).rejects.toMatchObject({ statusCode: 409 });
    await expect(registerPushSubscription(other.owner, input, other.store)).rejects.toMatchObject({ statusCode: 409 });
    expect((await rows(owner))[0].sessionId).toBe(owner.sessionId);
    expect(await rows(other.owner)).toHaveLength(0);
    await removePushSubscription(peer, store);
    expect(await rows(owner)).toHaveLength(1);
    await removePushSubscription(owner, store);
    await removePushSubscription(owner, store);
    expect(await rows(owner)).toHaveLength(0);
  });

  it('fails closed for restricted, expired, wrong-account, stale-version and removed-membership owners', async () => {
    const { owner, store } = await fixture();
    const input = subscription();

    await save(store, owner, payload(owner, 'restricted'));
    await expect(registerPushSubscription(owner, input, store)).rejects.toThrow();
    await save(store, owner);
    const accountId = randomUUID();

    await db.insert(accounts).values({ id: accountId, ownerUserId: owner.userId, name: 'Other', slug: accountId });
    await db.insert(accountMemberships).values({ id: randomUUID(), accountId, userId: owner.userId, role: 'owner' });
    await expect(registerPushSubscription({ ...owner, accountId }, input, store)).rejects.toMatchObject({
      statusCode: 403,
    });
    await db.update(users).set({ authVersion: 2 }).where(eq(users.id, owner.userId));
    await expect(registerPushSubscription(owner, input, store)).rejects.toMatchObject({ statusCode: 403 });
    await db.update(users).set({ authVersion: 1 }).where(eq(users.id, owner.userId));
    await db.delete(accountMemberships).where(eq(accountMemberships.userId, owner.userId));
    await expect(registerPushSubscription(owner, input, store)).rejects.toMatchObject({ statusCode: 403 });
    const expired = payload(owner);

    expired.cookie.expires = DateTime.utc().minus({ seconds: 1 }).toJSDate();
    await save(store, owner, expired);
    await expect(registerPushSubscription(owner, input, store)).rejects.toThrow();
    expect(await rows(owner)).toHaveLength(0);
  });

  it('serializes capacity checks across sessions and caps each account/user at eight registrations', async () => {
    const { owner, store } = await fixture();
    const peers = Array.from({ length: 9 }, () => ({ ...owner, sessionId: randomUUID() }));

    for (const peer of peers) await save(store, peer);
    const results = await Promise.allSettled(
      peers.map((peer) => registerPushSubscription(peer, subscription(), store)),
    );

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(8);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(await rows(owner)).toHaveLength(8);
    const [expired] = await rows(owner);

    await db
      .update(pushSubscriptions)
      .set({ expiresAt: DateTime.utc().minus({ seconds: 1 }).toJSDate() })
      .where(eq(pushSubscriptions.id, expired.id));
    await expirePushSubscriptions();
    expect(await rows(owner)).toHaveLength(7);
  });

  it('cleans only a revoked memory session and cannot revive its registration with a delayed save', async () => {
    const { owner, store } = await fixture();
    const peer = { ...owner, sessionId: randomUUID() };

    await save(store, peer);
    await registerPushSubscription(owner, subscription(), store);
    await registerPushSubscription(peer, subscription(), store);
    await new Promise<void>((resolve, reject) =>
      store.destroy(owner.sessionId, (error) => (error ? reject(error) : resolve())),
    );
    expect((await rows(owner)).map(({ sessionId }) => sessionId)).toEqual([peer.sessionId]);
    await save(store, owner);
    await expect(registerPushSubscription(owner, subscription(), store)).rejects.toThrow();
  });

  it('rejects an enrollment queued behind session revocation without leaving a subscription', async () => {
    const { owner, store } = await fixture();
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const lease = store.withSessionAuthority(
      { userId: owner.userId, authVersion: 1, currentSid: owner.sessionId },
      async () => {
        started();
        await blocked;
      },
    );

    await ready;
    const revoked = new Promise<void>((resolve, reject) =>
      store.destroy(owner.sessionId, (error) => (error ? reject(error) : resolve())),
    );
    const enrolled = registerPushSubscription(owner, subscription(), store);
    const rejected = expect(enrolled).rejects.toThrow();

    release();
    await lease;
    await revoked;
    await rejected;
    expect(await rows(owner)).toHaveLength(0);
  });

  it('cleans memory registrations before publishing an account change or restricted authority', async () => {
    const { owner, store } = await fixture();
    const input = subscription();
    const next = { ...owner, accountId: randomUUID() };

    await db
      .insert(accounts)
      .values({ id: next.accountId, ownerUserId: next.userId, name: 'Next', slug: next.accountId });
    await db
      .insert(accountMemberships)
      .values({ id: randomUUID(), accountId: next.accountId, userId: next.userId, role: 'owner' });
    await registerPushSubscription(owner, input, store);
    await save(store, next);
    expect(await rows(owner)).toHaveLength(0);
    await expect(registerPushSubscription(owner, input, store)).rejects.toMatchObject({ statusCode: 403 });
    await registerPushSubscription(next, input, store);
    expect((await rows(owner))[0].accountId).toBe(next.accountId);
    await save(store, next, payload(next, 'restricted'));
    expect(await rows(owner)).toHaveLength(0);
  });

  it('retains a permanent memory tombstone if scope-change cleanup fails', async () => {
    const { owner } = await fixture();
    const store = new ManagedMemorySessionStore(async () => {
      throw new Error('Cleanup unavailable');
    });

    await save(store, owner);
    await expect(save(store, owner, payload(owner, 'restricted'))).rejects.toThrow('Cleanup unavailable');
    await save(store, owner);
    const current = await new Promise<unknown>((resolve, reject) =>
      store.get(owner.sessionId, (error, value) => (error ? reject(error) : resolve(value))),
    );

    expect(current).toBeNull();
    await expect(registerPushSubscription(owner, subscription(), store)).rejects.toThrow();
  });

  it('removes registrations atomically on persisted session revocation/scope changes, auth-version changes and membership deletion', async () => {
    const { owner, store } = await fixture();

    await db.insert(userSessions).values({
      sid: owner.sessionId,
      sess: payload(owner),
      expiresAt: DateTime.utc().plus({ minutes: 1 }).toJSDate(),
    });
    await registerPushSubscription(owner, subscription(), store);
    await db
      .update(userSessions)
      .set({ revokedAt: DateTime.utc().toJSDate(), sess: {} })
      .where(eq(userSessions.sid, owner.sessionId));
    expect(await rows(owner)).toHaveLength(0);
    await db
      .update(userSessions)
      .set({ revokedAt: null, sess: payload(owner) })
      .where(eq(userSessions.sid, owner.sessionId));
    await registerPushSubscription(owner, subscription(), store);
    await db
      .update(userSessions)
      .set({ sess: payload({ ...owner, accountId: randomUUID() }) })
      .where(eq(userSessions.sid, owner.sessionId));
    expect(await rows(owner)).toHaveLength(0);
    await db
      .update(userSessions)
      .set({ sess: payload(owner) })
      .where(eq(userSessions.sid, owner.sessionId));
    await registerPushSubscription(owner, subscription(), store);
    await db.update(users).set({ authVersion: 2 }).where(eq(users.id, owner.userId));
    expect(await rows(owner)).toHaveLength(0);
    await db.update(users).set({ authVersion: 1 }).where(eq(users.id, owner.userId));
    await registerPushSubscription(owner, subscription(), store);
    await db.delete(accountMemberships).where(eq(accountMemberships.userId, owner.userId));
    expect(await rows(owner)).toHaveLength(0);
  });

  it('enforces account and user RLS for non-owner roles, including write checks', async () => {
    const target = await fixture();
    const other = await fixture();

    await registerPushSubscription(target.owner, subscription(), target.store);
    await registerPushSubscription(other.owner, subscription(), other.store);
    const colleague = { ...other.owner, accountId: target.owner.accountId, sessionId: randomUUID() };

    await db
      .insert(accountMemberships)
      .values({ id: randomUUID(), accountId: colleague.accountId, userId: colleague.userId, role: 'member' });
    await save(other.store, colleague);
    await registerPushSubscription(colleague, subscription(), other.store);
    const visible = await db.transaction(async (transaction) => {
      await transaction.execute(sql.raw('SET LOCAL ROLE push_reader'));
      await transaction.execute(sql`SELECT set_config('app.current_account_id', ${target.owner.accountId}, true)`);
      await transaction.execute(sql`SELECT set_config('app.current_user_id', ${target.owner.userId}, true)`);

      return transaction.select().from(pushSubscriptions);
    });

    expect(visible).toHaveLength(1);
    expect(visible[0].userId).toBe(target.owner.userId);
    await expect(
      db.transaction(async (transaction) => {
        await transaction.execute(sql.raw('SET LOCAL ROLE push_reader'));
        await transaction.execute(sql`SELECT set_config('app.current_account_id', ${target.owner.accountId}, true)`);
        await transaction.execute(sql`SELECT set_config('app.current_user_id', ${target.owner.userId}, true)`);
        await transaction
          .update(pushSubscriptions)
          .set({ userId: other.owner.userId })
          .where(eq(pushSubscriptions.id, visible[0].id));
      }),
    ).rejects.toThrow();
  });
});
