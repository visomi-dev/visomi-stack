import './auth-middleware-setup';

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import request from 'supertest';

import { removeAccessMethod } from './access-methods';
import { listSentMessages } from './auth-mail';
import { appFor, identity, password } from './auth-middleware-fixture';

import {
  authDeviceApprovalRequests,
  accountPasskeyCredentials,
  authEnrollmentGrants,
  authOperationGrants,
  db,
  users,
} from 'shared';

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
    const user = await identity();
    const agent = request.agent(appFor(user));

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
    const foreignUser = await identity();
    const foreign = request.agent(appFor(foreignUser));
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

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await requester
        .post('/auth/device-approval/consume')
        .set('Origin', origin)
        .send({ requestId, userCode: wrongCode })
        .expect(401);
    }
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
    const user = await identity();
    const agent = request.agent(appFor(user));

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
    const user = await identity();
    const agent = request.agent(appFor(user));

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
    const user = await identity();
    const agent = request.agent(appFor(user));

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
      const user = await identity();
      const agent = request.agent(appFor(user));

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
});
