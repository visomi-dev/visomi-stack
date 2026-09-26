import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import express, { json } from 'express';
import session from 'express-session';
import request from 'supertest';

import { passport } from '../auth/passport';
import * as mail from '../auth/auth-mail';

import { accountRouter } from './account-router';
import {
  exportProfile,
  leaveWorkspace,
  requestEmailChange,
  transferWorkspaceOwnership,
  verifyEmailChange,
} from './account-service';
import type { AccountContext } from './account-service';

import {
  accounts,
  accountMemberships,
  authIdentityFlows,
  authOperationGrants,
  authVerificationChallenges,
  db,
  env,
  errorHandler,
  ManagedMemorySessionStore,
  projects,
  users,
} from 'shared';

jest.mock('shared', () => {
  const actual = jest.requireActual('shared');
  const { PGlite } = jest.requireActual('@electric-sql/pglite');
  const { drizzle } = jest.requireActual('drizzle-orm/pglite');

  return { ...actual, db: drizzle(new PGlite(), { casing: 'snake_case' }) };
});

jest.mock('../shared/env', () => ({
  env: { ...jest.requireActual('../shared/env').env, MAIL_TRANSPORT: 'memory' },
}));

beforeAll(async () => {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
}, 30000);
afterAll(async () => {
  await (db as unknown as { $client: PGlite }).$client.close();
});
afterEach(() => {
  jest.restoreAllMocks();
  mail.clearMailbox();
});

async function identity(role = 'member') {
  const userId = randomUUID();
  const ownerId = randomUUID();
  const accountId = randomUUID();

  await db.insert(users).values([
    {
      id: userId,
      email: `${userId}@example.test`,
      emailVerifiedAt: new Date(),
      passwordHash: 'never-export-this-hash',
    },
    { id: ownerId, email: `${ownerId}@example.test` },
  ]);
  await db.insert(accounts).values({
    id: accountId,
    name: 'Shared workspace',
    slug: accountId,
    ownerUserId: role === 'owner' ? userId : ownerId,
  });
  await db
    .insert(accountMemberships)
    .values([
      { id: randomUUID(), accountId, userId, role },
      ...(role === 'owner' ? [] : [{ id: randomUUID(), accountId, userId: ownerId, role: 'owner' }]),
    ]);
  const context: AccountContext = { userId, accountId, authVersion: 1, sessionBinding: randomUUID() };

  return { context, ownerId, email: `${userId}@example.test` };
}

function appFor(context: AccountContext, email: string, authority: 'full' | 'restricted' = 'full') {
  const app = express();

  app.use(
    json(),
    session({
      secret: 'account-lifecycle-tests',
      resave: false,
      saveUninitialized: false,
      store: new ManagedMemorySessionStore(),
    }),
  );
  app.use(passport.initialize(), passport.session());
  app.post('/login', (req, res, next) =>
    req.login(
      {
        id: context.userId,
        accountId: context.accountId,
        role: 'member',
        email,
        emailVerifiedAt: new Date().toISOString(),
        authority,
        authVersion: 1,
      },
      (error) => {
        if (error) return next(error);
        req.session.authority = authority;
        res.json({ sid: req.sessionID });
      },
    ),
  );
  app.use('/account', accountRouter);
  app.use(errorHandler);

  return app;
}

async function grant(context: AccountContext, purpose = 'workspace_leave') {
  const id = randomUUID();

  await db.insert(authOperationGrants).values({
    id,
    userId: context.userId,
    sessionBinding: context.sessionBinding,
    purpose,
    verifiedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });

  return id;
}

describe('account lifecycle with persisted membership and identity', () => {
  const origin = new URL(env.APP_BASE_URL).origin;

  it('requires full authority, same-origin requests, and a purpose/session-bound grant', async () => {
    const { context, email } = await identity();
    const app = appFor(context, email);

    await request(app).get('/account/profile').expect(401);
    const restricted = request.agent(appFor(context, email, 'restricted'));

    await restricted.post('/login').expect(200);
    await restricted.get('/account/profile').expect(403);
    const agent = request.agent(app);
    const login = await agent.post('/login').expect(200);

    await agent
      .post('/account/workspace/leave')
      .set('Origin', 'https://evil.example')
      .send({ grantId: randomUUID() })
      .expect(403);
    await agent
      .post('/account/workspace/leave')
      .set('Origin', origin)
      .send({ grantId: await grant(context) })
      .expect(401);
    const sessionContext = { ...context, sessionBinding: login.body.sid };

    await agent
      .post('/account/workspace/leave')
      .set('Origin', origin)
      .send({ grantId: await grant(sessionContext, 'email_change') })
      .expect(401);
    await agent
      .post('/account/workspace/leave')
      .set('Origin', origin)
      .send({ grantId: await grant(sessionContext) })
      .expect(200);
    await agent.get('/account/profile').expect(401);
    expect(await db.select().from(users).where(eq(users.id, context.userId))).toHaveLength(1);
  });

  it('leaves only the selected membership and preserves shared records and other memberships', async () => {
    const { context } = await identity();
    const otherAccount = randomUUID();
    const projectId = randomUUID();

    await db
      .insert(accounts)
      .values({ id: otherAccount, name: 'Other', slug: otherAccount, ownerUserId: context.userId });
    await db
      .insert(accountMemberships)
      .values({ id: randomUUID(), accountId: otherAccount, userId: context.userId, role: 'owner' });
    await db.insert(projects).values({
      id: projectId,
      accountId: context.accountId,
      name: 'Preserved',
      slug: projectId,
      createdByUserId: context.userId,
    });
    expect(await leaveWorkspace(context)).toMatchObject({ left: true, hasRemainingMemberships: true });
    expect(await db.select().from(accounts).where(eq(accounts.id, context.accountId))).toHaveLength(1);
    expect(await db.select().from(projects).where(eq(projects.id, projectId))).toHaveLength(1);
    expect(
      await db.select().from(accountMemberships).where(eq(accountMemberships.userId, context.userId)),
    ).toMatchObject([{ accountId: otherAccount }]);
    expect((await db.select().from(users).where(eq(users.id, context.userId)))[0].authVersion).toBe(2);
    await expect(leaveWorkspace(context)).rejects.toMatchObject({ code: 'account_authority_changed' });
  });

  it('requires actual ownership transfer even if another role-owner exists', async () => {
    const { context, ownerId } = await identity('owner');

    await db
      .insert(accountMemberships)
      .values({ id: randomUUID(), userId: ownerId, accountId: context.accountId, role: 'owner' });
    await expect(leaveWorkspace(context)).rejects.toMatchObject({ code: 'ownership_transfer_required' });
    await expect(transferWorkspaceOwnership(context, randomUUID())).rejects.toMatchObject({
      code: 'ownership_target_invalid',
    });
    await transferWorkspaceOwnership(context, ownerId);
    await expect(leaveWorkspace(context)).resolves.toMatchObject({ left: true });
    expect((await db.select().from(accounts).where(eq(accounts.id, context.accountId)))[0].ownerUserId).toBe(ownerId);
  });

  it('blocks the last owner role even when the account pointer is inconsistent', async () => {
    const { context } = await identity();

    await db
      .update(accountMemberships)
      .set({ role: 'member' })
      .where(eq(accountMemberships.accountId, context.accountId));
    await db
      .update(accountMemberships)
      .set({ role: 'owner' })
      .where(and(eq(accountMemberships.accountId, context.accountId), eq(accountMemberships.userId, context.userId)));
    await expect(leaveWorkspace(context)).rejects.toMatchObject({ code: 'ownership_transfer_required' });
    await expect(transferWorkspaceOwnership(context, context.userId)).rejects.toMatchObject({
      code: 'workspace_owner_required',
    });
  });

  it('keeps the primary email until proof, binds proof to the session, and prevents replay', async () => {
    const { context, email } = await identity();
    const newEmail = `${randomUUID()}@example.test`;
    const challenge = await requestEmailChange(context, newEmail);
    const pin = mail.listSentMessages().find((message) => message.challengeId === challenge.flowId)!.pin;

    expect((await db.select().from(users).where(eq(users.id, context.userId)))[0].email).toBe(email);
    await expect(
      verifyEmailChange({ ...context, sessionBinding: 'other-session' }, challenge.flowId, pin),
    ).rejects.toMatchObject({ code: 'email_verification_unavailable' });
    const completions = await Promise.allSettled([
      verifyEmailChange(context, challenge.flowId, pin),
      verifyEmailChange(context, challenge.flowId, pin),
    ]);

    expect(completions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await db.select().from(users).where(eq(users.id, context.userId)))[0]).toMatchObject({
      email: newEmail,
      authVersion: 2,
      preferencesConfigured: false,
    });
    expect(
      mail.listSentMessages().filter((message) => message.challengeId === 'email-change-notification'),
    ).toMatchObject([{ email }]);
    await expect(verifyEmailChange({ ...context, authVersion: 2 }, challenge.flowId, pin)).rejects.toMatchObject({
      code: 'email_verification_unavailable',
    });
  });

  it('commits invalid-code attempts and locks out the proof after five failures', async () => {
    const { context } = await identity();
    const challenge = await requestEmailChange(context, `${randomUUID()}@example.test`);
    const pin = mail.listSentMessages()[0].pin;
    const wrongPin = pin === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 5; attempt++)
      await expect(verifyEmailChange(context, challenge.flowId, wrongPin)).rejects.toMatchObject({
        code: 'invalid_verification_code',
      });
    expect(
      (await db.select().from(authVerificationChallenges).where(eq(authVerificationChallenges.id, challenge.flowId)))[0]
        .attemptCount,
    ).toBe(5);
    await expect(verifyEmailChange(context, challenge.flowId, pin)).rejects.toMatchObject({
      code: 'email_verification_unavailable',
    });
  });

  it('rejects expired, wrong-address and stale-auth-version proofs', async () => {
    const { context } = await identity();
    const challenge = await requestEmailChange(context, `${randomUUID()}@example.test`);
    const pin = mail.listSentMessages()[0].pin;

    await db
      .update(authIdentityFlows)
      .set({ expiresAt: new Date(0) })
      .where(eq(authIdentityFlows.id, challenge.flowId));
    await expect(verifyEmailChange(context, challenge.flowId, pin)).rejects.toMatchObject({
      code: 'email_verification_unavailable',
    });
    await db
      .update(authIdentityFlows)
      .set({ expiresAt: new Date(Date.now() + 60_000), pendingEmail: 'substituted@example.test' })
      .where(eq(authIdentityFlows.id, challenge.flowId));
    await expect(verifyEmailChange(context, challenge.flowId, pin)).rejects.toMatchObject({
      code: 'email_verification_unavailable',
    });
    await db.update(users).set({ authVersion: 2 }).where(eq(users.id, context.userId));
    await expect(verifyEmailChange(context, challenge.flowId, pin)).rejects.toMatchObject({
      code: 'account_authority_changed',
    });
  });

  it('rejects an address taken between request and verification', async () => {
    const { context } = await identity();
    const newEmail = `${randomUUID()}@example.test`;
    const challenge = await requestEmailChange(context, newEmail);
    const pin = mail.listSentMessages()[0].pin;

    await db.insert(users).values({ id: randomUUID(), email: newEmail });
    await expect(verifyEmailChange(context, challenge.flowId, pin)).rejects.toMatchObject({
      code: 'email_unavailable',
    });
    expect((await db.select().from(users).where(eq(users.id, context.userId)))[0].authVersion).toBe(1);
  });

  it('reports post-commit notification failure truthfully', async () => {
    const { context } = await identity();
    const newEmail = `${randomUUID()}@example.test`;
    const challenge = await requestEmailChange(context, newEmail);
    const pin = mail.listSentMessages()[0].pin;

    jest.spyOn(mail, 'sendEmailChangeNotification').mockRejectedValue(new Error('Mail unavailable'));
    await expect(verifyEmailChange(context, challenge.flowId, pin)).resolves.toEqual({
      changed: true,
      signInRequired: true,
      notification: 'failed',
    });
    expect((await db.select().from(users).where(eq(users.id, context.userId)))[0].email).toBe(newEmail);
  });

  it('saves validated preferences and exports only allowlisted metadata', async () => {
    const { context, email } = await identity();
    const agent = request.agent(appFor(context, email));

    await agent.post('/login').expect(200);
    const initial = await agent.get('/account/profile').expect(200);

    expect(initial.body.data.profile.preferencesConfigured).toBe(false);
    await agent
      .patch('/account/profile')
      .set('Origin', origin)
      .send({ displayName: '  Ada  ', preferences: { locale: 'es', theme: 'dark' } })
      .expect(200);
    await agent
      .patch('/account/profile')
      .set('Origin', origin)
      .send({ displayName: 'Ada', preferences: { locale: 'es', theme: 'dark' }, authVersion: 99 })
      .expect(400);
    const exported = await exportProfile(context);

    expect(exported.scope).toBe('profile_and_membership_metadata');
    expect(exported.profile).toMatchObject({
      displayName: 'Ada',
      preferences: { locale: 'es', theme: 'dark' },
      preferencesConfigured: true,
    });
    expect(Object.keys(exported.profile).sort()).toEqual([
      'createdAt',
      'displayName',
      'email',
      'emailVerifiedAt',
      'id',
      'preferences',
      'preferencesConfigured',
      'updatedAt',
    ]);
    expect(JSON.stringify(exported)).not.toContain('never-export-this-hash');
    expect(Object.keys(exported).sort()).toEqual(['exportedAt', 'memberships', 'profile', 'schemaVersion', 'scope']);
  });
});
