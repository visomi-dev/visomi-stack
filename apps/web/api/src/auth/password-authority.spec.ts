import './auth-middleware-setup';

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import request from 'supertest';

import { listSentMessages } from './auth-mail';
import { resendEmailOtp } from './auth-service';
import { consumeFactorVerificationLimit } from './passkey-security';
import { replaceRecoveryCodes } from './auth-factors';
import { startPasswordReset, completePasswordReset } from './password-account';
import { startPasswordSignIn, verifyPasswordTotp, verifyPasswordEmailOtp } from './password-session';
import { appFor, identity, password } from './auth-middleware-fixture';

import {
  authIdentityFlows,
  authOperationGrants,
  db,
  userTotpEnrollments,
  users,
  userFederatedIdentities,
  userRecoveryCodes,
  authEmailChallenges,
} from 'shared';

describe('password authority with persisted sessions', () => {
  it.each(['totp_change', 'google_unlink'] as const)(
    'uses a verified session-bound single-use %s grant',
    async (purpose) => {
      const user = await identity();
      const agent = request.agent(appFor(user));
      const other = request.agent(appFor(user));

      await agent.post('/test/login').expect(204);
      await other.post('/test/login').expect(204);
      const identityId = randomUUID();

      await db.insert(userFederatedIdentities).values({
        id: identityId,
        userId: user.id,
        provider: 'google',
        issuer: 'https://accounts.google.com',
        subject: randomUUID(),
        emailAtLink: user.email,
      });
      const mutate = (client: typeof agent, body: { grantId?: string }) =>
        (purpose === 'totp_change'
          ? client.post('/auth/totp/setup')
          : client.delete(`/auth/security/federated/${identityId}`)
        )
          .set('Origin', 'http://localhost:8080')
          .send(body);

      await mutate(agent, {}).expect(400);
      const start = await agent
        .post('/auth/reauth/start')
        .set('Origin', 'http://localhost:8080')
        .send({ purpose })
        .expect(201);
      const grantId = start.body.data.grantId as string;

      await mutate(agent, { grantId }).expect(401);
      await agent
        .post('/auth/reauth/complete')
        .set('Origin', 'http://localhost:8080')
        .send({ grantId, method: 'password', password })
        .expect(200);
      await mutate(other, { grantId }).expect(401);
      await mutate(agent, { grantId }).expect(purpose === 'totp_change' ? 201 : 204);
      await mutate(agent, { grantId }).expect(401);
    },
  );

  it.each(['expired', 'wrong-purpose'] as const)(
    'rejects %s grants before changing either security method',
    async (invalid) => {
      const user = await identity();
      const agent = request.agent(appFor(user));

      await agent.post('/test/login');
      const { body: context } = await agent.get('/test/context').expect(200);
      const identityId = randomUUID();

      await db.insert(userFederatedIdentities).values({
        id: identityId,
        userId: user.id,
        provider: 'google',
        issuer: 'https://accounts.google.com',
        subject: randomUUID(),
        emailAtLink: user.email,
      });
      for (const purpose of ['totp_change', 'google_unlink']) {
        const grantId = randomUUID();

        await db.insert(authOperationGrants).values({
          id: grantId,
          userId: user.id,
          sessionBinding: context.sessionId,
          purpose: invalid === 'wrong-purpose' ? 'password_change' : purpose,
          verifiedAt: new Date(),
          expiresAt: new Date(Date.now() + (invalid === 'expired' ? -1000 : 60_000)),
        });
        await (
          purpose === 'totp_change'
            ? agent.post('/auth/totp/setup')
            : agent.delete(`/auth/security/federated/${identityId}`)
        )
          .set('Origin', 'http://localhost:8080')
          .send({ grantId })
          .expect(401);
      }
      const observedResult1 = await db
        .select()
        .from(userTotpEnrollments)
        .where(eq(userTotpEnrollments.userId, user.id));

      expect(observedResult1).toHaveLength(0);
      const observedResult2 = await db
        .select()
        .from(userFederatedIdentities)
        .where(eq(userFederatedIdentities.id, identityId));

      expect(observedResult2[0].revokedAt).toBeNull();
    },
  );

  it.each([false, true])(
    'binds restricted account selection to the email proof epoch (changed=%s)',
    async (changed) => {
      const user = await identity();
      const agent = request.agent(appFor(user));
      const pending = await agent
        .post('/auth/email-otp/request')
        .set('Origin', 'http://localhost:8080')
        .send({ email: user.email })
        .expect(202);
      const flowId = pending.body.data.flowId as string;
      const pin = listSentMessages().find((message) => message.challengeId === flowId)!.pin;

      await agent
        .post('/auth/email-otp/verify')
        .set('Origin', 'http://localhost:8080')
        .send({ flowId, pin })
        .expect(200);
      if (changed) {
        await db
          .update(users)
          .set({ email: `${randomUUID()}@example.test`, authVersion: (user.authVersion ?? 1) + 1 })
          .where(eq(users.id, user.id));
      }
      await agent
        .post('/auth/restricted/accounts/select')
        .set('Origin', 'http://localhost:8080')
        .send({ accountId: user.accountId })
        .expect(changed ? 401 : 200);
      if (changed) {
        await agent
          .post('/auth/password/set')
          .set('Origin', 'http://localhost:8080')
          .send({ password: 'an attacker replacement password' })
          .expect(401);
      } else {
        const observedResult3 = await agent.get('/test/context').expect(200);

        expect(observedResult3.body.user.authVersion).toBe(user.authVersion);
      }
    },
  );

  it.each(['expired', 'terminal', 'completed', 'stale-proof'] as const)(
    'rejects %s password proof even with a fresh email code',
    async (invalid) => {
      const user = await identity();
      const flow = await startPasswordSignIn(user.email, password, 'context', 'session');
      const pin = listSentMessages().find((message) => message.challengeId === flow.flowId)!.pin;

      await db
        .update(authIdentityFlows)
        .set(
          invalid === 'expired'
            ? { expiresAt: new Date(0) }
            : invalid === 'terminal'
              ? { terminalAt: new Date() }
              : invalid === 'completed'
                ? { completedAt: new Date() }
                : { passwordProofAt: new Date(0) },
        )
        .where(eq(authIdentityFlows.id, flow.flowId));
      await expect(verifyPasswordEmailOtp(flow.flowId, pin, 'context', 'session')).rejects.toMatchObject({
        code: 'verification_failed',
      });
      const [challenge] = await db
        .select()
        .from(authEmailChallenges)
        .where(eq(authEmailChallenges.flowId, flow.flowId));

      expect(challenge.consumedAt).toBeNull();
      if (invalid === 'expired') {
        await db
          .update(authEmailChallenges)
          .set({ lastSentAt: new Date(0) })
          .where(eq(authEmailChallenges.id, challenge.id));
        await expect(resendEmailOtp(flow.flowId, 'context')).rejects.toMatchObject({ code: 'verification_failed' });
      }
    },
  );

  it('atomically completes a password email proof only once', async () => {
    const user = await identity();
    const flow = await startPasswordSignIn(user.email, password, 'context', 'session');
    const pin = listSentMessages().find((message) => message.challengeId === flow.flowId)!.pin;
    const results = await Promise.allSettled(
      [0, 1].map(() => verifyPasswordEmailOtp(flow.flowId, pin, 'context', 'session')),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('supports recovery-code password verification exactly once without disabling TOTP', async () => {
    const user = await identity();
    const enrollmentId = randomUUID();

    await db.insert(userTotpEnrollments).values({
      id: enrollmentId,
      userId: user.id,
      encryptedSecret: 'secret',
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [code] = await replaceRecoveryCodes(user.id);
    const flow = await startPasswordSignIn(user.email, password, 'context', 'session');

    await expect(verifyPasswordTotp(flow.flowId, code, 'other', 'recovery_code')).rejects.toMatchObject({
      code: 'verification_failed',
    });
    const results = await Promise.allSettled(
      [0, 1].map(() => verifyPasswordTotp(flow.flowId, code, 'session', 'recovery_code')),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const next = await startPasswordSignIn(user.email, password, 'context', 'session');

    await expect(verifyPasswordTotp(next.flowId, code, 'session', 'recovery_code')).rejects.toMatchObject({
      code: 'verification_failed',
    });
    const observedResult4 = await db.select().from(userTotpEnrollments).where(eq(userTotpEnrollments.id, enrollmentId));

    expect(observedResult4[0].status).toBe('active');
    const observedResult5 = await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, user.id));

    expect(observedResult5.filter((item) => item.usedAt)).toHaveLength(1);
  });

  it('bounds reset factor guesses atomically and refuses a correct factor after exhaustion', async () => {
    const user = await identity();

    await db.insert(userTotpEnrollments).values({
      id: randomUUID(),
      userId: user.id,
      encryptedSecret: 'secret',
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const flow = await startPasswordReset(user.email, 'context', 'session');
    const pin = listSentMessages().find((message) => message.challengeId === flow.flowId)!.pin;
    const attempt = (code: string) =>
      completePasswordReset(flow.flowId, pin, { kind: 'totp', code }, password, 'context', 'session', 'reset-ip');
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => attempt('000000')));

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    const observedResult6 = await db.select().from(authIdentityFlows).where(eq(authIdentityFlows.id, flow.flowId));

    expect(observedResult6[0].attemptCount).toBe(5);
    await expect(attempt('123456')).rejects.toMatchObject({ code: 'verification_failed' });
    const observedResult7 = await db.select().from(users).where(eq(users.id, user.id));

    expect(observedResult7[0].authVersion).toBe(user.authVersion);
  });

  it.each(['epoch', 'proof', 'attempts'] as const)(
    'does not consume recovery codes with invalid %s password authority',
    async (invalid) => {
      const user = await identity();

      await db.insert(userTotpEnrollments).values({
        id: randomUUID(),
        userId: user.id,
        encryptedSecret: 'secret',
        status: 'active',
        expiresAt: new Date(Date.now() + 60_000),
      });
      const [code] = await replaceRecoveryCodes(user.id);
      const flow = await startPasswordSignIn(user.email, password, 'context', 'session');

      if (invalid === 'epoch') {
        await db
          .update(users)
          .set({ authVersion: (user.authVersion ?? 1) + 1 })
          .where(eq(users.id, user.id));
      } else {
        await db
          .update(authIdentityFlows)
          .set(invalid === 'proof' ? { passwordProofAt: null } : { attemptCount: 5 })
          .where(eq(authIdentityFlows.id, flow.flowId));
      }
      await expect(verifyPasswordTotp(flow.flowId, code, 'session', 'recovery_code')).rejects.toMatchObject({
        code: 'verification_failed',
      });
      const observedResult8 = await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, user.id));

      expect(observedResult8.filter((item) => item.usedAt)).toHaveLength(0);
    },
  );

  it('establishes a full password session through the recovery-code HTTP contract', async () => {
    const user = await identity();
    const agent = request.agent(appFor(user));

    await db.insert(userTotpEnrollments).values({
      id: randomUUID(),
      userId: user.id,
      encryptedSecret: 'secret',
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [code] = await replaceRecoveryCodes(user.id);
    const pending = await agent
      .post('/auth/password/sign-in')
      .set('Origin', 'http://localhost:8080')
      .send({ email: user.email, password })
      .expect(202);
    const response = await agent
      .post('/auth/password/verify')
      .set('Origin', 'http://localhost:8080')
      .send({ flowId: pending.body.data.flowId, code, kind: 'recovery_code' })
      .expect(200);

    expect(response.body.data).toMatchObject({
      authenticated: true,
      user: { id: user.id, secondFactor: 'recovery_code' },
    });
    const observedResult9 = await agent.get('/test/context').expect(200);

    expect(observedResult9.body.user.authority).toBe('full');
  });

  it.each(['user', 'ip'] as const)(
    'enforces the shared reset %s budget before consuming a valid proof',
    async (dimension) => {
      const user = await identity();
      const flow = await startPasswordReset(user.email, 'context', 'session', 'request-ip');
      const pin = listSentMessages().find((message) => message.challengeId === flow.flowId)!.pin;

      for (let index = 0; index < 30; index++) {
        await consumeFactorVerificationLimit(
          dimension === 'user' ? user.id : `other-${index}`,
          dimension === 'ip' ? 'reset-ip' : `other-${index}`,
        );
      }
      await expect(
        completePasswordReset(flow.flowId, pin, undefined, password, 'context', 'session', 'reset-ip'),
      ).rejects.toMatchObject({ code: 'verification_failed' });
      const observedResult10 = await db
        .select()
        .from(authEmailChallenges)
        .where(eq(authEmailChallenges.flowId, flow.flowId));

      expect(observedResult10[0].consumedAt).toBeNull();
      const observedResult11 = await db.select().from(users).where(eq(users.id, user.id));

      expect(observedResult11[0].authVersion).toBe(user.authVersion);
    },
  );

  it.each(['totp', 'recovery_code'] as const)(
    'resets with %s atomically, preserves enrollment and rejects replay',
    async (kind) => {
      const user = await identity();
      const enrollmentId = randomUUID();

      await db.insert(userTotpEnrollments).values({
        id: enrollmentId,
        userId: user.id,
        encryptedSecret: 'secret',
        status: 'active',
        expiresAt: new Date(Date.now() + 60_000),
      });
      const [recoveryCode] = await replaceRecoveryCodes(user.id);
      const flow = await startPasswordReset(user.email, 'context', 'session');
      const pin = listSentMessages().find((message) => message.challengeId === flow.flowId)!.pin;
      const factor = { kind, code: kind === 'totp' ? '123456' : recoveryCode };
      const wrong = pin === '000000' ? '111111' : '000000';

      await expect(
        completePasswordReset(flow.flowId, wrong, factor, password, 'context', 'session'),
      ).rejects.toMatchObject({ code: 'verification_failed' });
      const results = await Promise.allSettled(
        [0, 1].map(() => completePasswordReset(flow.flowId, pin, factor, password, 'context', 'session')),
      );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const observedResult12 = await db.select().from(users).where(eq(users.id, user.id));

      expect(observedResult12[0].authVersion).toBe((user.authVersion ?? 1) + 1);
      const observedResult13 = await db
        .select()
        .from(userTotpEnrollments)
        .where(eq(userTotpEnrollments.id, enrollmentId));

      expect(observedResult13[0].status).toBe('active');
      const next = await startPasswordSignIn(user.email, password, 'context', 'session');

      await expect(verifyPasswordTotp(next.flowId, factor.code, 'session', kind)).rejects.toMatchObject({
        code: 'verification_failed',
      });
    },
  );

  it('shares factor budgets across fresh flows by both user and IP', async () => {
    for (let index = 0; index < 30; index++) {
      const observedResult14 = await consumeFactorVerificationLimit('same-user', `ip-${index}`);

      expect(observedResult14).toBe(true);
    }
    const observedResult15 = await consumeFactorVerificationLimit('same-user', 'fresh-ip');

    expect(observedResult15).toBe(false);
    for (let index = 0; index < 30; index++) {
      const observedResult16 = await consumeFactorVerificationLimit(`user-${index}`, 'same-ip');

      expect(observedResult16).toBe(true);
    }
    const observedResult17 = await consumeFactorVerificationLimit('fresh-user', 'same-ip');

    expect(observedResult17).toBe(false);
  });
});
