import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import express, { json } from 'express';
import session from 'express-session';
import request from 'supertest';

import { authRouter } from './auth-router';
import { passport } from './passport';
import { establishFullSession } from './auth-session';
import { authed } from './auth-middleware';
import { removeAccessMethod } from './access-methods';
import { listSentMessages } from './auth-mail';
import {
  findOrCreateUserByEmail,
  resolveAuthUserForAccount,
  setUserPassword,
  startPasswordSignIn,
  verifyPasswordTotp,
} from './auth-service';
import { resetPasskeySecurityState } from './passkey-security';
import { verifyTotpCode } from './totp';

import {
  authDeviceApprovalRequests,
  accountPasskeyCredentials,
  authEnrollmentGrants,
  authIdentityFlows,
  authOperationGrants,
  db,
  errorHandler,
  ManagedMemorySessionStore,
  userTotpEnrollments,
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

  return { ...actual, env: { ...actual.env, DATABASE_DRIVER: 'memory' } };
});
jest.mock('./totp', () => ({
  decryptTotpSecret: jest.fn(() => 'test-secret'),
  verifyTotpCode: jest.fn(async (_secret: string, code: string) => code === '123456'),
  totpTimeStep: () => 1,
}));

const store = new ManagedMemorySessionStore();
const password = 'a secure test password';

function appFor(user: Express.User) {
  const app = express();

  app.use(json());
  app.use(
    session({ secret: 'authentication-regression-session-secret', resave: false, saveUninitialized: false, store }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  app.post('/test/login', (req, res, next) => {
    req.login(user, (error) => {
      if (error) return next(error);
      req.session.authority = user.authority;
      if (user.authority === 'restricted')
        req.session.restrictedAuth = {
          allowedOperations: ['password:set', 'passkeys:enroll'],
          eligibleAccounts: [{ accountId: user.accountId, role: user.role, name: 'Test' }],
          expiresAt: Date.now() + 60_000,
          flowId: randomUUID(),
          issuedAt: Date.now(),
          isNewUser: true,
          purpose: 'bootstrap_recovery',
          selectedAccountId: user.accountId,
          userId: user.id,
          verifiedEmail: user.email,
        };
      res.sendStatus(204);
    });
  });
  // Simulate the verified assertion boundary; Passport and session storage stay real.
  app.post('/test/passkey', authed({ authority: 'full' }), async (req, res) => {
    await establishFullSession(req, res, {
      ...req.user!,
      authority: 'full',
      authenticationMethod: 'passkey',
      authVersion: req.user!.authVersion!,
    });
    req.session.passkeySecurityReauthenticatedAt = Date.now();
    res.json({ sessionId: req.sessionID, grantId: req.session.reauthGrantId, nonce: req.session.googleNonce });
  });
  app.get('/test/context', authed(), (req, res) =>
    res.json({
      user: req.user,
      sessionId: req.sessionID,
      restricted: req.session.restrictedAuth,
      nonce: req.session.googleNonce,
    }),
  );
  app.use('/auth', authRouter);
  app.use(errorHandler);

  return app;
}

async function identity(authority: 'full' | 'restricted' = 'full') {
  const user = await findOrCreateUserByEmail(`${randomUUID()}@example.test`);

  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
  const authVersion = await setUserPassword(user.id, password);

  return { ...(await resolveAuthUserForAccount({ ...user, authVersion })), authority };
}

beforeAll(async () => {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
}, 30_000);
afterAll(async () => {
  await new Promise<void>((resolve, reject) => store.clear((error) => (error ? reject(error) : resolve())));
  await (db as unknown as { $client: PGlite }).$client.close();
});
beforeEach(() => {
  resetPasskeySecurityState();
  jest.mocked(verifyTotpCode).mockClear();
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => store.clear((error) => (error ? reject(error) : resolve())));
  store.removeAllListeners();
});

describe('authentication middleware with persisted sessions', () => {
  it('does not remove the only primary method or count a pending passkey', async () => {
    const user = await identity();

    await db.insert(accountPasskeyCredentials).values({
      id: randomUUID(),
      accountId: user.accountId,
      userId: user.id,
      credentialId: randomUUID(),
      publicKey: 'fixture-public-key',
      rpId: 'localhost',
      label: 'Pending',
      status: 'pending',
    });
    await expect(removeAccessMethod(user, { kind: 'password', currentPassword: password })).rejects.toMatchObject({
      code: 'last_access_method',
      statusCode: 409,
    });
    const [stored] = await db.select().from(users).where(eq(users.id, user.id));

    expect(stored.passwordHash).not.toBeNull();
    expect(stored.authVersion).toBe(user.authVersion);
  });

  it('serializes password and passkey removal so a concurrent pair cannot remove all access', async () => {
    const user = await identity();
    const credentialId = randomUUID();

    await db.insert(accountPasskeyCredentials).values({
      id: randomUUID(),
      accountId: user.accountId,
      userId: user.id,
      credentialId,
      publicKey: 'fixture-public-key',
      rpId: 'localhost',
      label: 'Existing',
      status: 'active',
      activatedAt: new Date(),
    });
    const outcomes = await Promise.allSettled([
      removeAccessMethod(user, { kind: 'password', currentPassword: password }),
      removeAccessMethod(user, { kind: 'passkey', credentialId }),
    ]);
    const [stored] = await db.select().from(users).where(eq(users.id, user.id));
    const [credential] = await db
      .select()
      .from(accountPasskeyCredentials)
      .where(eq(accountPasskeyCredentials.credentialId, credentialId));

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(Boolean(stored.passwordHash) || credential.revokedAt === null).toBe(true);
  });

  it('requires a bound fresh password factor before first-passkey enrollment and rejects replay', async () => {
    const user = await identity();
    const agent = request.agent(appFor(user));
    const other = request.agent(appFor(user));

    await agent.post('/test/login');
    await other.post('/test/login');
    const pending = await agent
      .post('/auth/passkey/enrollment/start')
      .set('Origin', 'http://localhost:8080')
      .send({ currentPassword: password })
      .expect(202);
    const flowId = pending.body.data.flowId as string;
    const pin = listSentMessages().find((message) => message.challengeId === flowId)?.pin;

    expect(pin).toMatch(/^\d{6}$/);
    await other
      .post('/auth/passkey/enrollment/complete')
      .set('Origin', 'http://localhost:8080')
      .send({ flowId, code: pin, kind: 'email' })
      .expect(401);
    await agent
      .post('/auth/passkey/enrollment/complete')
      .set('Origin', 'http://localhost:8080')
      .send({ flowId, code: pin, kind: 'totp' })
      .expect(401);
    await agent
      .post('/auth/passkey/enrollment/complete')
      .set('Origin', 'http://localhost:8080')
      .send({ flowId, code: pin, kind: 'email' })
      .expect(200);
    await agent
      .post('/auth/passkey/enrollment/complete')
      .set('Origin', 'http://localhost:8080')
      .send({ flowId, code: pin, kind: 'email' })
      .expect(401);
    const grants = await db.select().from(authEnrollmentGrants).where(eq(authEnrollmentGrants.userId, user.id));

    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ accountId: user.accountId, source: 'password_enrollment' });
  });
  it('reports only enrolled confirmation methods and truthful overview fields', async () => {
    const agent = request.agent(appFor(await identity()));

    await agent.post('/test/login').expect(204);
    const started = await agent
      .post('/auth/reauth/start')
      .set('Origin', 'http://localhost:8080')
      .send({ purpose: 'password_change' })
      .expect(201);

    expect(started.body.data.methods).toEqual(['password']);
    expect(started.body.data.passwordRequiresTotp).toBe(false);
    expect(Date.parse(started.body.data.expiresAt)).toBeGreaterThan(Date.now());
    const overview = await agent.get('/auth/security/overview').expect(200);

    expect(overview.body.data).toMatchObject({ passwordEnabled: true, totpEnabled: false, recoveryCodesRemaining: 0 });
    expect(JSON.stringify(overview.body)).not.toContain('passwordHash');
  });

  it('requires another session, rejects foreign approval review, and prevents approval after cancellation', async () => {
    const user = await identity();
    const requester = request.agent(appFor(user));
    const approver = request.agent(appFor(user));
    const foreign = request.agent(appFor(await identity()));
    const origin = 'http://localhost:8080';

    await requester.post('/test/login');
    await approver.post('/test/login');
    await foreign.post('/test/login');
    await requester.post('/test/passkey');
    await approver.post('/test/passkey');
    const created = await requester
      .post('/auth/device-approval/request')
      .set('Origin', origin)
      .send({ accountId: user.accountId })
      .expect(201);
    const { requestId } = created.body.data;

    await requester.post('/auth/device-approval/approve').set('Origin', origin).send({ requestId }).expect(409);
    await foreign.post('/auth/device-approval/review').set('Origin', origin).send({ requestId }).expect(404);
    const review = await approver
      .post('/auth/device-approval/review')
      .set('Origin', origin)
      .send({ requestId })
      .expect(200);

    expect(review.body.data).toMatchObject({ status: 'pending', requester: false });
    expect(review.body.data.userCode).toBeUndefined();
    await requester.post('/auth/device-approval/cancel').set('Origin', origin).send({ requestId }).expect(200);
    await approver.post('/auth/device-approval/approve').set('Origin', origin).send({ requestId }).expect(409);
    await requester.post('/auth/device-approval/consume').set('Origin', origin).send(created.body.data).expect(400);
    await requester
      .post('/auth/device-approval/consume')
      .set('Origin', origin)
      .send({ requestId, userCode: created.body.data.userCode })
      .expect(401);
  });

  it('checks expiry in approval mutations and limits user-code attempts', async () => {
    const user = await identity();
    const requester = request.agent(appFor(user));
    const approver = request.agent(appFor(user));
    const origin = 'http://localhost:8080';

    await requester.post('/test/login');
    await approver.post('/test/login');
    await approver.post('/test/passkey');
    const created = await requester
      .post('/auth/device-approval/request')
      .set('Origin', origin)
      .send({ accountId: user.accountId });
    const { requestId, userCode } = created.body.data;

    await db
      .update(authDeviceApprovalRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authDeviceApprovalRequests.id, requestId));
    await approver.post('/auth/device-approval/approve').set('Origin', origin).send({ requestId }).expect(409);
    await db
      .update(authDeviceApprovalRequests)
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where(eq(authDeviceApprovalRequests.id, requestId));
    await approver.post('/auth/device-approval/approve').set('Origin', origin).send({ requestId }).expect(200);
    const wrongCode = userCode === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 5; attempt += 1)
      await requester
        .post('/auth/device-approval/consume')
        .set('Origin', origin)
        .send({ requestId, userCode: wrongCode })
        .expect(401);
    await requester
      .post('/auth/device-approval/consume')
      .set('Origin', origin)
      .send({ requestId, userCode })
      .expect(401);
  });

  it('creates at most one enrollment grant when approved consumption races cancellation', async () => {
    const user = await identity();
    const requester = request.agent(appFor(user));
    const approver = request.agent(appFor(user));
    const origin = 'http://localhost:8080';

    await requester.post('/test/login');
    await approver.post('/test/login');
    await approver.post('/test/passkey');
    const created = await requester
      .post('/auth/device-approval/request')
      .set('Origin', origin)
      .send({ accountId: user.accountId });
    const { requestId, userCode } = created.body.data;

    await approver.post('/auth/device-approval/approve').set('Origin', origin).send({ requestId }).expect(200);
    const responses = await Promise.all([
      requester.post('/auth/device-approval/consume').set('Origin', origin).send({ requestId, userCode }),
      requester.post('/auth/device-approval/cancel').set('Origin', origin).send({ requestId }),
    ]);
    const grants = await db.select().from(authEnrollmentGrants).where(eq(authEnrollmentGrants.userId, user.id));

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(grants).toHaveLength(responses[0].status === 200 ? 1 : 0);
    await requester
      .post('/auth/device-approval/consume')
      .set('Origin', origin)
      .send({ requestId, userCode })
      .expect(401);
  });
  it('applies the shared verification limit to both password verification aliases', async () => {
    const agent = request.agent(appFor(await identity()));

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await agent
        .post('/auth/password/verify')
        .set('Origin', 'http://localhost:8080')
        .send({ flowId: randomUUID(), kind: 'totp', code: '000000' })
        .expect(401);
    }
    const limited = await agent
      .post('/auth/sign-in/verify')
      .set('Origin', 'http://localhost:8080')
      .send({ flowId: randomUUID(), kind: 'totp', code: '123456' })
      .expect(429);

    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('exhausts pending reauthentication grants without verifying them', async () => {
    const agent = request.agent(appFor(await identity()));

    await agent.post('/test/login').expect(204);
    const started = await agent
      .post('/auth/reauth/start')
      .set('Origin', 'http://localhost:8080')
      .send({ purpose: 'recovery_codes_regenerate' })
      .expect(201);
    const grantId = started.body.data.grantId;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await agent
        .post('/auth/reauth/complete')
        .set('Origin', 'http://localhost:8080')
        .send({ grantId, method: 'password', password: 'incorrect password' })
        .expect(401);
    }
    await agent
      .post('/auth/reauth/complete')
      .set('Origin', 'http://localhost:8080')
      .send({ grantId, method: 'password', password })
      .expect(401);
    const [grant] = await db.select().from(authOperationGrants).where(eq(authOperationGrants.id, grantId));

    expect(grant.verifiedAt).toBeNull();
    expect(grant.attemptCount).toBe(5);
  });

  it('consumes a verified grant only once under concurrent requests', async () => {
    const agent = request.agent(appFor(await identity()));

    await agent.post('/test/login').expect(204);
    const started = await agent
      .post('/auth/reauth/start')
      .set('Origin', 'http://localhost:8080')
      .send({ purpose: 'recovery_codes_regenerate' })
      .expect(201);
    const grantId = started.body.data.grantId;

    await agent
      .post('/auth/reauth/complete')
      .set('Origin', 'http://localhost:8080')
      .send({ grantId, method: 'password', password })
      .expect(200);
    const results = await Promise.all(
      Array.from({ length: 2 }, () =>
        agent.post('/auth/recovery-codes/regenerate').set('Origin', 'http://localhost:8080').send({ grantId }),
      ),
    );

    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
  });
  it.each(['totp_disable', 'recovery_codes_regenerate'] as const)(
    'requires verified, purpose-bound, single-use grants for %s',
    async (purpose) => {
      const agent = request.agent(appFor(await identity()));

      await agent.post('/test/login').expect(204);
      const started = await agent
        .post('/auth/reauth/start')
        .set('Origin', 'http://localhost:8080')
        .send({ purpose })
        .expect(201);
      const grantId = started.body.data.grantId;
      const path = purpose === 'totp_disable' ? '/auth/totp/disable' : '/auth/recovery-codes/regenerate';

      await agent.post(path).set('Origin', 'http://localhost:8080').send({ grantId }).expect(401);
      await agent
        .post('/auth/reauth/complete')
        .set('Origin', 'http://localhost:8080')
        .send({ grantId, method: 'password', password })
        .expect(200);
      const wrongPath = purpose === 'totp_disable' ? '/auth/recovery-codes/regenerate' : '/auth/totp/disable';

      await agent.post(wrongPath).set('Origin', 'http://localhost:8080').send({ grantId }).expect(401);
      await agent
        .post(path)
        .set('Origin', 'http://localhost:8080')
        .send({ grantId })
        .expect(purpose === 'totp_disable' ? 204 : 200);
      await agent.post(path).set('Origin', 'http://localhost:8080').send({ grantId }).expect(401);
    },
  );

  it('preserves the pending grant, session binding and Google nonce across passkey reauthentication', async () => {
    const user = await identity();

    await db.insert(accountPasskeyCredentials).values({
      id: randomUUID(),
      userId: user.id,
      accountId: user.accountId,
      credentialId: randomUUID(),
      publicKey: 'fixture-public-key',
      rpId: 'localhost',
      label: 'Existing key',
      status: 'active',
      activatedAt: new Date(),
    });
    const agent = request.agent(appFor(user));

    await agent.post('/test/login').expect(204);
    const started = await agent
      .post('/auth/reauth/start')
      .set('Origin', 'http://localhost:8080')
      .send({ purpose: 'google_link' })
      .expect(201);
    const before = await agent.get('/test/context').expect(200);
    const assertion = await agent.post('/test/passkey').expect(200);

    expect(assertion.body).toEqual({
      sessionId: before.body.sessionId,
      nonce: before.body.nonce,
      grantId: started.body.data.grantId,
    });
    await agent
      .post('/auth/reauth/complete')
      .set('Origin', 'http://localhost:8080')
      .send({ grantId: started.body.data.grantId, method: 'passkey' })
      .expect(200);
    const [grant] = await db
      .select()
      .from(authOperationGrants)
      .where(eq(authOperationGrants.id, started.body.data.grantId));

    expect(grant.verifiedAt).not.toBeNull();
    expect(grant.sessionBinding).toBe(before.body.sessionId);
  });

  it('keeps restricted enrollment authority after setting a password and invalidates other sessions', async () => {
    const user = await identity('restricted');
    const app = appFor(user);
    const agent = request.agent(app);
    const other = request.agent(app);

    await agent.post('/test/login').expect(204);
    await other.post('/test/login').expect(204);
    const before = await agent.get('/test/context').expect(200);

    await agent
      .post('/auth/password/set')
      .set('Origin', 'http://localhost:8080')
      .send({ password: 'another secure test password' })
      .expect(200);
    const after = await agent.get('/test/context').expect(200);

    expect(after.body.user.authority).toBe('restricted');
    expect(after.body.user.authVersion).toBe(user.authVersion! + 1);
    expect(after.body.restricted).toEqual(before.body.restricted);
    expect(after.body.sessionId).toBe(before.body.sessionId);
    await other.get('/test/context').expect(401);
    await agent.get('/auth/security/overview').expect(403);
  });

  it('rejects expired and foreign-session grants even after verification', async () => {
    const app = appFor(await identity());
    const agent = request.agent(app);
    const other = request.agent(app);

    await agent.post('/test/login').expect(204);
    await other.post('/test/login').expect(204);
    const start = await agent
      .post('/auth/reauth/start')
      .set('Origin', 'http://localhost:8080')
      .send({ purpose: 'recovery_codes_regenerate' })
      .expect(201);
    const grantId = start.body.data.grantId;

    await agent
      .post('/auth/reauth/complete')
      .set('Origin', 'http://localhost:8080')
      .send({ grantId, method: 'password', password })
      .expect(200);
    await other
      .post('/auth/recovery-codes/regenerate')
      .set('Origin', 'http://localhost:8080')
      .send({ grantId })
      .expect(401);
    await db
      .update(authOperationGrants)
      .set({ expiresAt: new Date(0) })
      .where(eq(authOperationGrants.id, grantId));
    await agent
      .post('/auth/recovery-codes/regenerate')
      .set('Origin', 'http://localhost:8080')
      .send({ grantId })
      .expect(401);
  });

  it('limits concurrent TOTP guesses and rejects a correct code after exhaustion', async () => {
    const user = await identity();

    await db.insert(userTotpEnrollments).values({
      id: randomUUID(),
      userId: user.id,
      encryptedSecret: 'fixture',
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const flow = await startPasswordSignIn(user.email, password, 'test-context', 'test-session');
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => verifyPasswordTotp(flow.flowId, '000000', 'test-session')),
    );

    expect(attempts.every((result) => result.status === 'rejected')).toBe(true);
    expect(verifyTotpCode).toHaveBeenCalledTimes(5);
    await expect(verifyPasswordTotp(flow.flowId, '123456', 'test-session')).rejects.toMatchObject({
      code: 'verification_failed',
    });
    const [stored] = await db.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, flow.flowId));

    expect(stored.attemptCount).toBe(5);
    expect(stored.completedAt).toBeNull();
    const next = await startPasswordSignIn(user.email, password, 'test-context', 'test-session');

    await expect(verifyPasswordTotp(next.flowId, '123456', 'test-session')).resolves.toMatchObject({
      user: { id: user.id },
    });
    await expect(verifyPasswordTotp(next.flowId, '123456', 'test-session')).rejects.toMatchObject({
      code: 'verification_failed',
    });
  });
});
