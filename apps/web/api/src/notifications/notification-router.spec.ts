import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import express, { json } from 'express';
import session from 'express-session';
import request from 'supertest';
import { generateVAPIDKeys } from 'web-push';

import { passport } from '../auth/passport';
import * as authService from '../auth/auth-identity';
import { createOpenApiDocument } from '../shared/http/openapi';

import { notificationRouter } from './notification-router';

import {
  accountMemberships,
  accounts,
  db,
  errorHandler,
  env,
  ManagedMemorySessionStore,
  recordNotification,
  pushSubscriptions,
  registerPushSubscription,
  revokeSessionPushSubscriptions,
  users,
} from 'shared';

jest.mock('../../../../../libs/backend/shared/src/lib/env', () => ({
  ...jest.requireActual('../../../../../libs/backend/shared/src/lib/env'),
  env: { ...jest.requireActual('../../../../../libs/backend/shared/src/lib/env').env, DATABASE_DRIVER: 'memory' },
}));

beforeAll(async () => {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
}, 30000);
beforeEach(() => {
  jest.replaceProperty(env, 'WEB_PUSH_ENABLED', false);
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(async () => {
  await (db as unknown as { $client: PGlite }).$client.close();
});

async function fixture() {
  const userId = randomUUID();
  const accountId = randomUUID();
  const id = randomUUID();

  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, emailVerifiedAt: new Date() });
  await db.insert(accounts).values({ id: accountId, ownerUserId: userId, name: 'Workspace', slug: accountId });
  await db.insert(accountMemberships).values({ id: randomUUID(), accountId, userId, role: 'owner' });
  await recordNotification({ accountId, userId }, id, 'service');
  const store = new ManagedMemorySessionStore(revokeSessionPushSubscriptions);
  const app = express();

  app.use(
    json(),
    session({
      store,
      secret: 'test-notification-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 60_000 },
    }),
    passport.initialize(),
    passport.session(),
  );
  app.post('/login', (req, res) => {
    req.session.authority = req.body.restricted ? 'restricted' : 'full';
    Object.assign(req.session, {
      passport: { user: { id: userId, accountId, authVersion: 1, authority: req.session.authority } },
    });
    res.sendStatus(204);
  });
  app.use('/notifications', notificationRouter);
  app.use(errorHandler);
  const agent = request.agent(app);

  agent.set('Origin', process.env['WEBAUTHN_ORIGIN'] ?? new URL(env.APP_BASE_URL).origin);

  await agent.post('/login').send({}).expect(204);
  const sessions = await new Promise<Record<string, session.SessionData>>((resolve, reject) =>
    store.all((error, rows) => (error ? reject(error) : resolve(rows ?? {}))),
  );
  const sessionId = Object.keys(sessions)[0];

  return { app, agent, accountId, userId, id, store, sessionId };
}

function subscription() {
  const key = createECDH('prime256v1');

  key.generateKeys();

  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

describe('notification HTTP contracts', () => {
  it('rejects restricted-session reads and mutations without leaking an inbox', async () => {
    const { agent, id } = await fixture();

    await agent.post('/login').send({ restricted: true }).expect(204);
    const denied = await agent.get('/notifications').expect(403);

    expect(denied.headers['cache-control']).toBe('no-store');
    expect(denied.body.data).toBeUndefined();
    // A mutation also requires a live restricted-flow grant; this fixture has none.
    await agent.post(`/notifications/${id}/read`).expect(401);
    await agent.post('/notifications/preferences').send({ servicePush: true }).expect(401);
  });
  it('retains a valid session across transient membership lookup failure instead of treating it as revocation', async () => {
    const { agent, id } = await fixture();
    const lookup = jest
      .spyOn(authService, 'resolveAuthUserForAccount')
      .mockRejectedValueOnce(new Error('Temporary database failure'));

    try {
      await agent.get('/notifications').expect(500);
      const recovered = await agent.get('/notifications').expect(200);

      expect(recovered.body.data.notifications[0].id).toBe(id);
    } finally {
      lookup.mockRestore();
    }
  });
  it('serves an uncached content-free inbox and validates preferences and read mutations', async () => {
    const { app, agent, id } = await fixture();
    const feed = await agent.get('/notifications').expect(200);

    expect(feed.headers['cache-control']).toBe('no-store');
    expect(feed.body.data).toMatchObject({
      notifications: [{ id, kind: 'service', read: false }],
      servicePush: false,
      pushAvailable: false,
    });
    expect(JSON.stringify(feed.body.data)).not.toContain('accountId');
    await request(app).get('/notifications').expect(401);
    await agent.post('/notifications/preferences').send({ servicePush: true }).expect(204);
    await agent.post('/notifications/preferences').send({ servicePush: true, familyPush: true }).expect(400);
    await agent.post('/notifications/not-a-uuid/read').expect(400);
    await agent.post(`/notifications/${id}/read`).expect(204);
    await agent.post(`/notifications/${randomUUID()}/read`).expect(204);
    const updated = await agent.get('/notifications').expect(200);

    expect(updated.body.data.servicePush).toBe(true);
    expect(updated.body.data.notifications[0].read).toBe(true);
  });

  it('rejects cross-origin mutations, revoked membership, stale authentication and foreign record access', async () => {
    const first = await fixture();
    const second = await fixture();

    await first.agent.post(`/notifications/${first.id}/read`).set('Origin', 'https://attacker.example').expect(403);
    await second.agent.post(`/notifications/${first.id}/read`).expect(204);
    const unchanged = await first.agent.get('/notifications').expect(200);

    expect(unchanged.body.data.notifications[0].read).toBe(false);
    await db.delete(accountMemberships).where(eq(accountMemberships.userId, second.userId));
    await second.agent.get('/notifications').expect(401);
    await db.update(users).set({ authVersion: 2 }).where(eq(users.id, first.userId));
    await first.agent.get('/notifications').expect(401);
  });

  it('documents inbox and opt-in push mutations without product fields', () => {
    const document = createOpenApiDocument();

    expect(document.paths?.['/notifications']?.get).toBeDefined();
    expect(document.paths?.['/notifications/preferences']?.post).toBeDefined();
    expect(document.paths?.['/notifications/{id}/read']?.post).toBeDefined();
    expect(document.paths?.['/notifications/subscriptions']?.post?.responses?.['503']).toBeDefined();
    expect(document.paths?.['/notifications/subscriptions']?.post?.responses?.['204']).toBeDefined();
    expect(document.paths?.['/notifications/subscriptions']?.get).toBeDefined();
    expect(document.paths?.['/notifications/subscriptions']?.delete).toBeDefined();
    expect(JSON.stringify(document.paths?.['/notifications'])).not.toContain('family');
  });

  it('validates subscription input but refuses public registration when delivery is disabled', async () => {
    const { agent, app, userId } = await fixture();
    const input = subscription();
    const unavailable = await agent.post('/notifications/subscriptions').send(input).expect(503);

    expect(unavailable.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(unavailable.body)).not.toContain(input.endpoint);
    expect(JSON.stringify(unavailable.body)).not.toContain(input.keys.auth);
    await agent
      .post('/notifications/subscriptions')
      .send({ ...input, endpoint: 'https://127.0.0.1/push' })
      .expect(400);
    await agent
      .post('/notifications/subscriptions')
      .send({ ...input, accountId: randomUUID() })
      .expect(400);
    await agent.post('/notifications/subscriptions').set('Origin', 'https://attacker.example').send(input).expect(403);
    await request(app)
      .post('/notifications/subscriptions')
      .set('Origin', process.env['WEBAUTHN_ORIGIN'] ?? new URL(env.APP_BASE_URL).origin)
      .send(input)
      .expect(401);
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))).toHaveLength(0);
  });

  it('advertises only the public VAPID key and scopes opt-in registration/status to the live session', async () => {
    const { publicKey, privateKey } = generateVAPIDKeys();

    jest.replaceProperty(env, 'WEB_PUSH_ENABLED', true);
    jest.replaceProperty(env, 'WEB_PUSH_PUBLIC_KEY', publicKey);
    jest.replaceProperty(env, 'WEB_PUSH_PRIVATE_KEY', privateKey);
    jest.replaceProperty(env, 'WEB_PUSH_SUBJECT', 'mailto:push@example.test');
    const first = await fixture();
    const second = await fixture();
    const input = subscription();
    const before = await first.agent.get('/notifications/subscriptions').expect(200);

    expect(before.headers['cache-control']).toBe('no-store');
    expect(before.body.data).toEqual({ available: true, publicKey, registered: false });
    expect(JSON.stringify(before.body)).not.toContain(privateKey);
    const feed = await first.agent.get('/notifications').expect(200);

    expect(feed.body.data.pushAvailable).toBe(true);
    await first.agent.post('/notifications/subscriptions').send(input).expect(204);
    const registered = await first.agent.get('/notifications/subscriptions').expect(200);

    expect(registered.body.data.registered).toBe(true);
    expect(JSON.stringify(registered.body)).not.toContain(input.endpoint);
    expect(JSON.stringify(registered.body)).not.toContain(input.keys.auth);
    await second.agent.post('/notifications/subscriptions').send(input).expect(409);
    const foreign = await second.agent.get('/notifications/subscriptions').expect(200);

    expect(foreign.body.data.registered).toBe(false);
    const anotherSession = request.agent(first.app);

    anotherSession.set('Origin', process.env['WEBAUTHN_ORIGIN'] ?? new URL(env.APP_BASE_URL).origin);
    await anotherSession.post('/login').send({}).expect(204);
    const sameOwner = await anotherSession.get('/notifications/subscriptions').expect(200);

    expect(sameOwner.body.data.registered).toBe(false);
    await first.agent.delete('/notifications/subscriptions').expect(204);
    const removed = await first.agent.get('/notifications/subscriptions').expect(200);

    expect(removed.body.data.registered).toBe(false);
  });

  it('fails closed when VAPID is incomplete or has mismatched keys', async () => {
    jest.replaceProperty(env, 'WEB_PUSH_ENABLED', true);
    jest.replaceProperty(env, 'WEB_PUSH_PUBLIC_KEY', generateVAPIDKeys().publicKey);
    jest.replaceProperty(env, 'WEB_PUSH_PRIVATE_KEY', generateVAPIDKeys().privateKey);
    jest.replaceProperty(env, 'WEB_PUSH_SUBJECT', 'mailto:push@example.test');
    const { agent } = await fixture();
    const capability = await agent.get('/notifications/subscriptions').expect(200);

    expect(capability.body.data).toEqual({ available: false, publicKey: null, registered: false });
    await agent.post('/notifications/subscriptions').send(subscription()).expect(503);
  });

  it('removes only the current authoritative session registration without returning endpoint secrets', async () => {
    const first = await fixture();
    const other = await fixture();

    await registerPushSubscription(
      { accountId: first.accountId, userId: first.userId, sessionId: first.sessionId, authVersion: 1 },
      subscription(),
      first.store,
    );
    await registerPushSubscription(
      { accountId: other.accountId, userId: other.userId, sessionId: other.sessionId, authVersion: 1 },
      subscription(),
      other.store,
    );
    await first.agent.delete('/notifications/subscriptions').set('Origin', 'https://attacker.example').expect(403);
    const removed = await first.agent.delete('/notifications/subscriptions').expect(204);

    expect(removed.headers['cache-control']).toBe('no-store');
    expect(removed.text).toBe('');
    await first.agent.delete('/notifications/subscriptions').expect(204);
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, first.userId))).toHaveLength(0);
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, other.userId))).toHaveLength(1);
    await db.update(users).set({ authVersion: 2 }).where(eq(users.id, other.userId));
    await other.agent.delete('/notifications/subscriptions').expect(401);
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, other.userId))).toHaveLength(0);
  });
});
