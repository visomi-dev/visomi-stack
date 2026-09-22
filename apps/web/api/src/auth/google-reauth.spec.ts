import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import express, { json } from 'express';
import session from 'express-session';
import { OAuth2Client, type LoginTicket, type TokenPayload } from 'google-auth-library';
import request from 'supertest';

import { authRouter } from './auth-router';
import { passkeyRouter } from './passkey-router';
import { authed } from './auth-middleware';
import { establishFullSession } from './auth-session';
import { passport } from './passport';
import { findOrCreateUserByEmail, resolveAuthUserForAccount, setUserPassword } from './auth-service';
import { resetPasskeySecurityState } from './passkey-security';

import {
  accountPasskeyCredentials,
  authEnrollmentGrants,
  authOperationGrants,
  db,
  errorHandler,
  ManagedMemorySessionStore,
  userFederatedIdentities,
  users,
} from 'shared';

jest.mock('shared', () => {
  const actual = jest.requireActual('shared');
  const { PGlite } = jest.requireActual('@electric-sql/pglite');
  const { drizzle } = jest.requireActual('drizzle-orm/pglite');

  return { ...actual, db: drizzle(new PGlite(), { casing: 'snake_case' }) };
});
jest.mock('../shared/env', () => {
  const actual = jest.requireActual('../shared/env');

  return { ...actual, env: { ...actual.env, DATABASE_DRIVER: 'memory', GOOGLE_AUTH_CLIENT_ID: 'google-test-client' } };
});

const store = new ManagedMemorySessionStore();
const verify = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken');
const origin = 'http://localhost:8080';

function appFor(user?: Express.User) {
  const app = express();

  app.use(json());
  app.use(session({ secret: 'google-reauth-test-session-secret', resave: false, saveUninitialized: false, store }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.post('/test/login', (req, res, next) => {
    if (!user) return res.sendStatus(401);
    req.login(user, (error) => {
      if (error) return next(error);
      req.session.authority = 'full';
      res.sendStatus(204);
    });
  });
  app.use('/auth', authRouter);
  // Model the verified assertion boundary while preserving real session and grant checks.
  app.post('/test/passkey', authed({ authority: 'full' }), async (req, res) => {
    await establishFullSession(req, res, {
      ...req.user!,
      authority: 'full',
      authenticationMethod: 'passkey',
      authVersion: req.user!.authVersion!,
    });
    req.session.passkeySecurityReauthenticatedAt = Date.now();
    res.sendStatus(204);
  });
  app.use('/auth/passkey', passkeyRouter);
  app.use(errorHandler);

  return app;
}

async function setup(withPassword = false) {
  let user = await findOrCreateUserByEmail(`${randomUUID()}@example.test`);

  if (withPassword) user = { ...user, authVersion: await setUserPassword(user.id, 'secure test password') };
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
  const subject = randomUUID();
  const identityId = randomUUID();

  await db.insert(userFederatedIdentities).values({
    id: identityId,
    provider: 'google',
    issuer: 'https://accounts.google.com',
    subject,
    userId: user.id,
    emailAtLink: user.email,
  });
  const app = appFor({ ...(await resolveAuthUserForAccount(user)), authority: 'full' });
  const agent = request.agent(app);

  await agent.post('/test/login').expect(204);

  return { agent, app, user, subject, identityId };
}

function proof(subject: string, nonce: string, extra: Partial<TokenPayload> = {}) {
  verify.mockImplementation(
    async () =>
      ({
        getPayload: () => ({
          sub: subject,
          nonce,
          iss: 'https://accounts.google.com',
          email: 'verified@example.test',
          email_verified: true,
          ...extra,
        }),
      }) as LoginTicket,
  );
}

beforeAll(async () => {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
}, 30_000);
beforeEach(() => {
  resetPasskeySecurityState();
  verify.mockReset();
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => store.clear((error) => (error ? reject(error) : resolve())));
  store.removeAllListeners();
});
afterAll(async () => {
  verify.mockRestore();
  await (db as unknown as { $client: PGlite }).$client.close();
});

describe('fresh Google reauthentication', () => {
  it('creates a verified Google primary email and authorizes first-passkey registration through the real session', async () => {
    const agent = request.agent(appFor());
    const email = `${randomUUID()}@example.test`;
    const subject = randomUUID();
    const start = await agent.post('/auth/identity/start').set('Origin', origin).expect(201);

    proof(subject, start.body.data.nonce, { email: email.toUpperCase() });
    const completed = await agent
      .post('/auth/google/complete')
      .set('Origin', origin)
      .send({ flowId: start.body.data.flowId, idToken: 'signup-token' })
      .expect(200);
    const [user] = await db.select().from(users).where(eq(users.email, email));

    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(completed.body.data.user).toMatchObject({
      id: user.id,
      email,
      emailVerifiedAt: user.emailVerifiedAt!.toISOString(),
      authority: 'full',
      authenticationMethod: 'google',
    });
    const reauth = await agent
      .post('/auth/reauth/start')
      .set('Origin', origin)
      .send({ purpose: 'passkey_enroll' })
      .expect(201);

    expect(reauth.body.data.methods).toEqual(['google']);
    expect(reauth.body.data.google.nonce).not.toBe(start.body.data.nonce);
    proof(subject, reauth.body.data.google.nonce, { email });
    await agent
      .post('/auth/reauth/complete')
      .set('Origin', origin)
      .send({ grantId: reauth.body.data.grantId, method: 'google', idToken: 'fresh-reauth-token' })
      .expect(200);
    await agent
      .post('/auth/passkey/enrollment/identity')
      .set('Origin', origin)
      .send({ grantId: reauth.body.data.grantId })
      .expect(200);
    await agent
      .post('/auth/passkey/registration/begin')
      .set('Origin', origin)
      .send({ label: 'First Google passkey' })
      .expect(200);
  });

  it('does not verify a linked user primary email changed while Google proof is pending', async () => {
    const { user, subject } = await setup();
    const agent = request.agent(appFor());
    const changedEmail = `${randomUUID()}@example.test`;
    const start = await agent.post('/auth/identity/start').set('Origin', origin).expect(201);

    verify.mockImplementation(async () => {
      await db
        .update(users)
        .set({ email: changedEmail, emailVerifiedAt: null, authVersion: user.authVersion + 1 })
        .where(eq(users.id, user.id));

      return {
        getPayload: () => ({
          sub: subject,
          nonce: start.body.data.nonce,
          iss: 'https://accounts.google.com',
          email: user.email,
          email_verified: true,
        }),
      } as LoginTicket;
    });
    const completed = await agent
      .post('/auth/google/complete')
      .set('Origin', origin)
      .send({ flowId: start.body.data.flowId, idToken: 'linked-token' })
      .expect(200);
    const [current] = await db.select().from(users).where(eq(users.id, user.id));

    expect(current.emailVerifiedAt).toBeNull();
    expect(completed.body.data.user).toMatchObject({
      id: user.id,
      email: changedEmail,
      emailVerifiedAt: null,
      authVersion: user.authVersion + 1,
    });
    await agent.get('/auth/security/overview').expect(200);
  });

  it('requires explicit linking instead of verifying or adopting an existing email match', async () => {
    const user = await findOrCreateUserByEmail(`${randomUUID()}@example.test`);
    const agent = request.agent(appFor());
    const start = await agent.post('/auth/identity/start').set('Origin', origin).expect(201);

    proof(randomUUID(), start.body.data.nonce, { email: user.email });
    const rejected = await agent
      .post('/auth/google/complete')
      .set('Origin', origin)
      .send({ flowId: start.body.data.flowId, idToken: 'unlinked-token' })
      .expect(409);
    const [current] = await db.select().from(users).where(eq(users.id, user.id));

    expect(rejected.body.code).toBe('google_link_required');
    expect(current.emailVerifiedAt).toBeNull();
    expect(
      await db.select().from(userFederatedIdentities).where(eq(userFederatedIdentities.userId, user.id)),
    ).toHaveLength(0);
    await agent.get('/auth/security/overview').expect(401);
  });

  it('does not automatically link two competing Google subjects creating the same email', async () => {
    const app = appFor();
    const agents = [request.agent(app), request.agent(app)];
    const email = `${randomUUID()}@example.test`;
    const subjects = [randomUUID(), randomUUID()];
    const starts = await Promise.all(
      agents.map((agent) => agent.post('/auth/identity/start').set('Origin', origin).expect(201)),
    );

    verify.mockImplementation(async (options) => {
      const index = options.idToken === 'first' ? 0 : 1;

      return {
        getPayload: () => ({
          sub: subjects[index],
          nonce: starts[index].body.data.nonce,
          iss: 'https://accounts.google.com',
          email,
          email_verified: true,
        }),
      } as LoginTicket;
    });
    const results = await Promise.all(
      agents.map((agent, index) =>
        agent
          .post('/auth/google/complete')
          .set('Origin', origin)
          .send({ flowId: starts[index].body.data.flowId, idToken: index === 0 ? 'first' : 'second' }),
      ),
    );

    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const created = await db.select().from(users).where(eq(users.email, email));
    const identities = await db
      .select()
      .from(userFederatedIdentities)
      .where(eq(userFederatedIdentities.userId, created[0].id));

    expect(created).toHaveLength(1);
    expect(identities).toHaveLength(1);
    expect(identities[0].subject).toBe(subjects[results.findIndex((result) => result.status === 200)]);
  });

  it('rolls back new verified-user creation when the Google subject is already reserved by a revoked link', async () => {
    const { identityId, subject } = await setup();
    const email = `${randomUUID()}@example.test`;
    const agent = request.agent(appFor());

    await db
      .update(userFederatedIdentities)
      .set({ revokedAt: new Date() })
      .where(eq(userFederatedIdentities.id, identityId));
    const start = await agent.post('/auth/identity/start').set('Origin', origin).expect(201);

    proof(subject, start.body.data.nonce, { email });
    await agent
      .post('/auth/google/complete')
      .set('Origin', origin)
      .send({ flowId: start.body.data.flowId, idToken: 'revoked-subject-token' })
      .expect(409);
    expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
  });

  it('accepts an offered active passkey after a fresh assertion without losing the challenge', async () => {
    const { agent, user } = await setup();
    const current = await resolveAuthUserForAccount(user);

    await db.insert(accountPasskeyCredentials).values({
      id: randomUUID(),
      userId: user.id,
      accountId: current.accountId,
      credentialId: randomUUID(),
      publicKey: 'assertion-boundary-fixture',
      rpId: 'localhost',
      label: 'Existing passkey',
      status: 'active',
    });
    const start = await agent
      .post('/auth/reauth/start')
      .set('Origin', origin)
      .send({ purpose: 'passkey_enroll' })
      .expect(201);
    const { grantId } = start.body.data;

    expect(start.body.data.methods).toEqual(['passkey', 'google']);
    await agent.post('/auth/reauth/complete').set('Origin', origin).send({ grantId, method: 'passkey' }).expect(401);
    await agent.post('/test/passkey').expect(204);
    await agent.post('/auth/reauth/complete').set('Origin', origin).send({ grantId, method: 'passkey' }).expect(200);
    await agent.post('/auth/passkey/enrollment/identity').set('Origin', origin).send({ grantId }).expect(200);
  });

  it('verifies the linked subject and audience, then exchanges a single-use enrollment grant', async () => {
    const { agent, subject, user } = await setup();
    const start = await agent
      .post('/auth/reauth/start')
      .set('Origin', origin)
      .send({ purpose: 'passkey_enroll' })
      .expect(201);
    const { grantId, google } = start.body.data;

    expect(start.body.data.methods).toEqual(['google']);
    expect(google.clientId).toBe('google-test-client');
    await agent.post('/auth/passkey/enrollment/identity').set('Origin', origin).send({ grantId }).expect(401);
    proof(subject, google.nonce);
    await agent
      .post('/auth/reauth/complete')
      .set('Origin', origin)
      .send({ grantId, method: 'google', idToken: 'fresh-token' })
      .expect(200);
    expect(verify).toHaveBeenCalledWith({ idToken: 'fresh-token', audience: 'google-test-client' });
    await agent
      .post('/auth/reauth/complete')
      .set('Origin', origin)
      .send({ grantId, method: 'google', idToken: 'fresh-token' })
      .expect(401);
    const results = await Promise.all(
      [1, 2].map(() => agent.post('/auth/passkey/enrollment/identity').set('Origin', origin).send({ grantId })),
    );

    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    const grants = await db.select().from(authEnrollmentGrants).where(eq(authEnrollmentGrants.userId, user.id));

    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ source: 'identity_enrollment', consumedAt: null });
    expect(grants[0].requesterSessionHash).toBeTruthy();
    expect(grants[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    await agent
      .post('/auth/passkey/registration/begin')
      .set('Origin', origin)
      .send({ label: 'First passkey' })
      .expect(200);
    await db
      .update(authEnrollmentGrants)
      .set({ consumedAt: new Date() })
      .where(eq(authEnrollmentGrants.id, grants[0].id));
    await agent.post('/auth/passkey/registration/begin').set('Origin', origin).send({ label: 'Replay' }).expect(401);
  });

  it('preserves registration freshness without an identity enrollment grant', async () => {
    const { agent } = await setup();

    await agent
      .post('/auth/passkey/registration/begin')
      .set('Origin', origin)
      .send({ label: 'Unauthorized' })
      .expect(401);
  });

  it.each([
    'foreign subject',
    'wrong nonce',
    'unverified email',
    'wrong issuer',
    'revoked identity',
    'provider rejection',
  ])('rejects %s without verifying the operation', async (reason) => {
    const { agent, subject, identityId, user } = await setup();
    const foreign = reason === 'foreign subject' ? await setup() : undefined;
    const start = await agent
      .post('/auth/reauth/start')
      .set('Origin', origin)
      .send({ purpose: 'passkey_enroll' })
      .expect(201);
    const { grantId, google } = start.body.data;

    proof(foreign?.subject ?? subject, reason === 'wrong nonce' ? 'old-nonce' : google.nonce, {
      email: user.email,
      ...(reason === 'unverified email' ? { email_verified: false } : {}),
      ...(reason === 'wrong issuer' ? { iss: 'https://foreign.example' } : {}),
    });
    if (reason === 'revoked identity')
      await db
        .update(userFederatedIdentities)
        .set({ revokedAt: new Date() })
        .where(eq(userFederatedIdentities.id, identityId));
    if (reason === 'provider rejection')
      verify.mockImplementation(async () => {
        throw new Error('Invalid audience or signature');
      });
    await agent
      .post('/auth/reauth/complete')
      .set('Origin', origin)
      .send({ grantId, method: 'google', idToken: 'token' })
      .expect(401);
    const [grant] = await db.select().from(authOperationGrants).where(eq(authOperationGrants.id, grantId));

    expect(grant.verifiedAt).toBeNull();
  });

  it('rejects weaker password proof for identity enrollment even when configured', async () => {
    const { agent } = await setup(true);
    const start = await agent
      .post('/auth/reauth/start')
      .set('Origin', origin)
      .send({ purpose: 'passkey_enroll' })
      .expect(201);

    expect(start.body.data.methods).toEqual(['google']);
    await agent
      .post('/auth/reauth/complete')
      .set('Origin', origin)
      .send({ grantId: start.body.data.grantId, method: 'password', password: 'secure test password' })
      .expect(401);
    await agent
      .post('/auth/passkey/enrollment/identity')
      .set('Origin', origin)
      .send({ grantId: start.body.data.grantId })
      .expect(401);
  });

  it('rejects stale challenges and tokens after a fresh start', async () => {
    const { agent, subject } = await setup();
    const old = await agent
      .post('/auth/reauth/start')
      .set('Origin', origin)
      .send({ purpose: 'passkey_enroll' })
      .expect(201);
    const fresh = await agent
      .post('/auth/reauth/start')
      .set('Origin', origin)
      .send({ purpose: 'passkey_enroll' })
      .expect(201);

    expect(fresh.body.data.google.nonce).not.toBe(old.body.data.google.nonce);
    proof(subject, old.body.data.google.nonce);
    for (const grantId of [old.body.data.grantId, fresh.body.data.grantId])
      await agent
        .post('/auth/reauth/complete')
        .set('Origin', origin)
        .send({ grantId, method: 'google', idToken: 'old-token' })
        .expect(401);
  });

  it('binds verified enrollment authorization to purpose, session and user', async () => {
    const { agent, app, subject } = await setup();
    const otherSession = request.agent(app);
    const otherUser = await setup();

    await otherSession.post('/test/login').expect(204);
    for (const purpose of ['google_link', 'passkey_enroll']) {
      const start = await agent.post('/auth/reauth/start').set('Origin', origin).send({ purpose }).expect(201);
      const { grantId, google } = start.body.data;

      proof(subject, google.nonce);
      await agent
        .post('/auth/reauth/complete')
        .set('Origin', origin)
        .send({ grantId, method: 'google', idToken: 'token' })
        .expect(200);
      await otherSession.post('/auth/passkey/enrollment/identity').set('Origin', origin).send({ grantId }).expect(401);
      await otherUser.agent
        .post('/auth/passkey/enrollment/identity')
        .set('Origin', origin)
        .send({ grantId })
        .expect(401);
      await agent
        .post('/auth/passkey/enrollment/identity')
        .set('Origin', origin)
        .send({ grantId })
        .expect(purpose === 'passkey_enroll' ? 200 : 401);
    }
  });
});
