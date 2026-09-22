import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import express, { json } from 'express';
import session from 'express-session';
import request from 'supertest';

import { env } from '../shared/env';

import { sessionRouter } from './session-router';
import { passport } from './passport';
import { findOrCreateUserByEmail, resolveAuthUserForAccount } from './auth-service';

import { authOperationGrants, db, errorHandler, ManagedMemorySessionStore } from 'shared';

jest.mock('shared', () => {
  const actual = jest.requireActual('shared');
  const { PGlite } = jest.requireActual('@electric-sql/pglite');
  const { drizzle } = jest.requireActual('drizzle-orm/pglite');

  return { ...actual, db: drizzle(new PGlite(), { casing: 'snake_case' }) };
});

function appFor(user: Express.User, store: ManagedMemorySessionStore) {
  const app = express();

  app.use(json(), session({ store, secret: 'session-router-tests', resave: false, saveUninitialized: false }));
  app.use(passport.initialize(), passport.session());
  app.post('/login', (req, res, next) =>
    req.login(user, (error) => {
      if (error) return next(error);
      req.session.authority = user.authority;
      res.json({ sid: req.sessionID });
    }),
  );
  app.use('/auth/sessions', sessionRouter);
  app.use(errorHandler);

  return app;
}

beforeAll(async () => {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
}, 30000);
afterAll(async () => {
  await (db as unknown as { $client: PGlite }).$client.close();
});

describe('session management routes', () => {
  const origin = process.env.WEBAUTHN_ORIGIN ?? new URL(env.APP_BASE_URL).origin;

  it('requires authentication and rejects restricted authority', async () => {
    const user = await findOrCreateUserByEmail(`${randomUUID()}@example.test`);
    const app = appFor(
      { ...(await resolveAuthUserForAccount(user)), authority: 'restricted' },
      new ManagedMemorySessionStore(),
    );

    await request(app).get('/auth/sessions').expect(401);
    const agent = request.agent(app);

    await agent.post('/login').expect(200);
    await agent.get('/auth/sessions').expect(403);
  });

  it('requires a one-use session-bound grant and revokes other real sessions', async () => {
    const user = await findOrCreateUserByEmail(`${randomUUID()}@example.test`);
    const store = new ManagedMemorySessionStore();
    const app = appFor({ ...(await resolveAuthUserForAccount(user)), authority: 'full' }, store);
    const current = request.agent(app);
    const other = request.agent(app);
    const login = await current.post('/login').expect(200);
    const otherLogin = await other.post('/login').expect(200);
    const list = await current.get('/auth/sessions').expect(200);

    expect(list.body.data).toHaveLength(2);
    expect(JSON.stringify(list.body)).not.toContain(login.body.sid);
    expect(JSON.stringify(list.body)).not.toContain(otherLogin.body.sid);
    await current
      .post('/auth/sessions/revoke-others')
      .set('Origin', origin)
      .send({ grantId: randomUUID() })
      .expect(401);
    await current
      .post('/auth/sessions/revoke-others')
      .set('Origin', 'https://evil.example')
      .send({ grantId: randomUUID() })
      .expect(403);
    const grantId = randomUUID();

    await db.insert(authOperationGrants).values({
      id: grantId,
      userId: user.id,
      purpose: 'sessions_revoke',
      sessionBinding: login.body.sid,
      verifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    });
    const result = await current
      .post('/auth/sessions/revoke-others')
      .set('Origin', origin)
      .send({ grantId })
      .expect(200);

    expect(result.body.data.revoked).toBe(1);
    await other.get('/auth/sessions').expect(401);
    const remaining = await current.get('/auth/sessions').expect(200);

    expect(remaining.body.data).toHaveLength(1);
    expect(remaining.body.data[0].current).toBe(true);
    await current.post('/auth/sessions/revoke-others').set('Origin', origin).send({ grantId }).expect(401);
  });
});
