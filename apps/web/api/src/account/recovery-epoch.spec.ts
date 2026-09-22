import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import express, { json } from 'express';
import session from 'express-session';
import request from 'supertest';

import { passport } from '../auth/passport';
import { authRouter } from '../auth/auth-router';
import * as recovery from '../auth/auth-service';
import { clearMailbox, listSentMessages } from '../auth/auth-mail';
import { verifySecret } from '../auth/auth-crypto';

import { requestEmailChange, verifyEmailChange } from './account-service';
import type { AccountContext } from './account-service';

import {
  accountMemberships,
  accounts,
  authEnrollmentGrants,
  authIdentityFlows,
  authVerificationChallenges,
  db,
  env,
  errorHandler,
  ManagedMemorySessionStore,
  users,
} from 'shared';

jest.mock('shared', () => {
  const actual = jest.requireActual('shared');
  const { PGlite } = jest.requireActual('@electric-sql/pglite');
  const { drizzle } = jest.requireActual('drizzle-orm/pglite');

  return { ...actual, db: drizzle(new PGlite(), { casing: 'snake_case' }) };
});
jest.mock('../shared/env', () => ({ env: { ...jest.requireActual('../shared/env').env, MAIL_TRANSPORT: 'memory' } }));

const store = new ManagedMemorySessionStore();
const origin = new URL(env.APP_BASE_URL).origin;
const app = express();

app.use(json(), session({ secret: 'recovery-epoch-tests', store, resave: false, saveUninitialized: false }));
app.use(passport.initialize(), passport.session());
app.get('/probe/session', (req, res) =>
  res.json({
    authenticated: req.isAuthenticated(),
    authVersion: req.user?.authVersion,
    grantId: req.session.enrollmentGrantId,
    authority: req.session.authority,
  }),
);
app.use('/auth', authRouter);
app.use(errorHandler);

beforeAll(async () => {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
}, 30000);
afterAll(async () => {
  store.clear();
  store.removeAllListeners();
  await (db as unknown as { $client: PGlite }).$client.close();
});
afterEach(() => {
  jest.restoreAllMocks();
  clearMailbox();
  store.clear();
});

async function identity() {
  const [user] = await db
    .insert(users)
    .values({ id: randomUUID(), email: `${randomUUID()}@example.test`, emailVerifiedAt: new Date() })
    .returning();
  const accountId = randomUUID();

  await db
    .insert(accounts)
    .values({ id: accountId, name: 'Recovery workspace', slug: accountId, ownerUserId: user.id });
  await db.insert(accountMemberships).values({ id: randomUUID(), userId: user.id, accountId, role: 'owner' });
  const context: AccountContext = {
    userId: user.id,
    accountId,
    authVersion: user.authVersion,
    sessionBinding: randomUUID(),
  };

  return { user, context };
}

async function identified(email: string) {
  const agent = request.agent(app);
  const start = await agent.post('/auth/identity/start').set('Origin', origin).expect(201);
  const flowId: string = start.body.data.flowId;

  await agent.post('/auth/identity/identify').set('Origin', origin).send({ flowId, email }).expect(202);

  return { agent, flowId };
}

async function recoveryRequest(email: string) {
  const identifiedFlow = await identified(email);

  await identifiedFlow.agent
    .post('/auth/identity/recovery/request')
    .set('Origin', origin)
    .send({ flowId: identifiedFlow.flowId, email })
    .expect(202);
  const message = listSentMessages().find((sent) => sent.challengeId === identifiedFlow.flowId);

  if (!message) throw new Error('Recovery message was not delivered.');

  return { ...identifiedFlow, pin: message.pin };
}

async function emailChange(context: AccountContext) {
  const email = `${randomUUID()}@example.test`;
  const challenge = await requestEmailChange(context, email);
  const message = listSentMessages().find((sent) => sent.challengeId === challenge.flowId);

  if (!message) throw new Error('Email-change message was not delivered.');

  return { email, complete: () => verifyEmailChange(context, challenge.flowId, message.pin) };
}

describe('existing-account email recovery epoch boundary', () => {
  it('binds issuance to user, purpose, email, session and authVersion; a raw PIN is not a generic challenge proof', async () => {
    const { user } = await identity();
    const { agent, flowId, pin } = await recoveryRequest(user.email);
    const [flow] = await db.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, flowId));
    const [challenge] = await db
      .select()
      .from(authVerificationChallenges)
      .where(eq(authVerificationChallenges.id, flowId));

    expect(flow).toMatchObject({
      userId: user.id,
      userAuthVersion: user.authVersion,
      intent: 'existing_account_recovery',
      authorizationMethod: 'email_recovery',
    });
    expect(await verifySecret(pin, challenge.pinHash)).toBe(false);
    await expect(
      recovery.consumeRecoveryAuthorization(flowId, pin, 'other-session', 'other-hash'),
    ).rejects.toMatchObject({ code: 'recovery_unavailable' });
    const verified = await agent
      .post('/auth/identity/recovery/verify')
      .set('Origin', origin)
      .send({ flowId, pin })
      .expect(200);

    expect(verified.body.data.verifiedEmail).toBe(user.email);
    const current = await agent.get('/probe/session').expect(200);

    expect(current.body).toMatchObject({ authenticated: true, authority: 'restricted', authVersion: user.authVersion });
    expect(current.body.grantId).toEqual(expect.any(String));
    await agent.post('/auth/identity/recovery/verify').set('Origin', origin).send({ flowId, pin }).expect(410);
  });

  it('rejects an outstanding old-address PIN after email change and terminalizes its legacy and bound authorization', async () => {
    const { user, context } = await identity();
    const old = await recoveryRequest(user.email);
    const change = await emailChange(context);

    await change.complete();
    const response = await old.agent
      .post('/auth/identity/recovery/verify')
      .set('Origin', origin)
      .send({ flowId: old.flowId, pin: old.pin });

    expect([401, 410]).toContain(response.status);
    expect((await old.agent.get('/probe/session')).body.authenticated).toBe(false);
    expect(
      (await db.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, old.flowId)))[0].terminalAt,
    ).not.toBeNull();
    expect(
      (await db.select().from(authVerificationChallenges).where(eq(authVerificationChallenges.id, old.flowId)))[0]
        .consumedAt,
    ).not.toBeNull();
    expect(await db.select().from(authEnrollmentGrants).where(eq(authEnrollmentGrants.userId, user.id))).toHaveLength(
      0,
    );
  });

  it('rejects an authVersion mismatch even without flow/challenge cleanup', async () => {
    const { user } = await identity();
    const old = await recoveryRequest(user.email);

    await db
      .update(users)
      .set({ authVersion: user.authVersion + 1 })
      .where(eq(users.id, user.id));
    await old.agent
      .post('/auth/identity/recovery/verify')
      .set('Origin', origin)
      .send({ flowId: old.flowId, pin: old.pin })
      .expect(401);
    expect(await db.select().from(authEnrollmentGrants).where(eq(authEnrollmentGrants.userId, user.id))).toHaveLength(
      0,
    );
  });

  it('rechecks the epoch when an email change wins after the route read but before proof consumption', async () => {
    const { user, context } = await identity();
    const old = await recoveryRequest(user.email);
    const change = await emailChange(context);
    const consume = recovery.consumeRecoveryAuthorization;

    jest.spyOn(recovery, 'consumeRecoveryAuthorization').mockImplementationOnce(async (...args) => {
      await change.complete();

      return consume(...args);
    });
    await old.agent
      .post('/auth/identity/recovery/verify')
      .set('Origin', origin)
      .send({ flowId: old.flowId, pin: old.pin })
      .expect(401);
    expect((await old.agent.get('/probe/session')).body.authenticated).toBe(false);
  });

  it('does not recreate an enrollment grant if email change wins during Passport session rotation', async () => {
    const { user, context } = await identity();
    const old = await recoveryRequest(user.email);
    const change = await emailChange(context);
    const bind = recovery.bindRecoveryEnrollmentSession;

    jest.spyOn(recovery, 'bindRecoveryEnrollmentSession').mockImplementationOnce(async (...args) => {
      await change.complete();

      return bind(...args);
    });
    await old.agent
      .post('/auth/identity/recovery/verify')
      .set('Origin', origin)
      .send({ flowId: old.flowId, pin: old.pin })
      .expect(401);
    expect((await old.agent.get('/probe/session')).body.authenticated).toBe(false);
    const grants = await db.select().from(authEnrollmentGrants).where(eq(authEnrollmentGrants.userId, user.id));

    expect(grants).toHaveLength(1);
    expect(grants[0].revokedAt).not.toBeNull();
    expect((await db.select().from(users).where(eq(users.id, user.id)))[0]).toMatchObject({
      email: change.email,
      authVersion: 2,
    });
  });

  it('revokes the restricted session and enrollment grant when recovery wins before email change', async () => {
    const { user, context } = await identity();
    const old = await recoveryRequest(user.email);

    await old.agent
      .post('/auth/identity/recovery/verify')
      .set('Origin', origin)
      .send({ flowId: old.flowId, pin: old.pin })
      .expect(200);
    expect((await old.agent.get('/probe/session')).body.authenticated).toBe(true);
    const change = await emailChange(context);

    await change.complete();
    expect((await old.agent.get('/probe/session')).body.authenticated).toBe(false);
    const grants = await db.select().from(authEnrollmentGrants).where(eq(authEnrollmentGrants.userId, user.id));

    expect(grants).toHaveLength(1);
    expect(grants[0].revokedAt).not.toBeNull();
  });

  it('serializes simultaneous recovery verification and email-change mutation without upgrading old proof authority', async () => {
    const { user, context } = await identity();
    const old = await recoveryRequest(user.email);
    const change = await emailChange(context);
    const [verified] = await Promise.all([
      old.agent.post('/auth/identity/recovery/verify').set('Origin', origin).send({ flowId: old.flowId, pin: old.pin }),
      change.complete(),
    ]);

    expect([200, 401, 410]).toContain(verified.status);
    expect((await old.agent.get('/probe/session')).body.authenticated).toBe(false);
    const grants = await db.select().from(authEnrollmentGrants).where(eq(authEnrollmentGrants.userId, user.id));

    expect(grants.every((grant) => grant.revokedAt !== null)).toBe(true);
  });

  it('refuses to issue recovery for a stale pre-change user snapshot', async () => {
    const { user, context } = await identity();
    const { flowId } = await identified(user.email);
    const [flow] = await db.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, flowId));
    const change = await emailChange(context);

    await change.complete();
    await expect(
      recovery.createRecoveryChallenge(
        user,
        flowId as `${string}-${string}-${string}-${string}-${string}`,
        flow.sessionBinding,
      ),
    ).rejects.toMatchObject({ code: 'recovery_unavailable' });
    expect(
      await db.select().from(authVerificationChallenges).where(eq(authVerificationChallenges.id, flowId)),
    ).toHaveLength(0);
  });

  it('does not bootstrap a replacement workspace for an existing identity without memberships', async () => {
    const { user } = await identity();

    await db.delete(accountMemberships).where(eq(accountMemberships.userId, user.id));
    const old = await recoveryRequest(user.email);

    await old.agent
      .post('/auth/identity/recovery/verify')
      .set('Origin', origin)
      .send({ flowId: old.flowId, pin: old.pin })
      .expect(401);
    expect(await db.select().from(accountMemberships).where(eq(accountMemberships.userId, user.id))).toHaveLength(0);
    expect(await db.select().from(users).where(eq(users.id, user.id))).toHaveLength(1);
  });

  it('preserves new-user bootstrap verification', async () => {
    const email = `${randomUUID()}@example.test`;
    const fresh = await recoveryRequest(email);

    await fresh.agent
      .post('/auth/identity/recovery/verify')
      .set('Origin', origin)
      .send({ flowId: fresh.flowId, pin: fresh.pin })
      .expect(200);
    const [user] = await db.select().from(users).where(eq(users.email, email));

    expect(user).toBeDefined();
    expect(await db.select().from(accountMemberships).where(eq(accountMemberships.userId, user.id))).toHaveLength(1);
  });
});
