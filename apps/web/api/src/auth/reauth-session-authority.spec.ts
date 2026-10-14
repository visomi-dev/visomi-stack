import './auth-middleware-setup';

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import request from 'supertest';

import { startPasswordSignIn, verifyPasswordTotp } from './password-session';
import { verifyTotpCode } from './totp';
import { appFor, identity, password } from './auth-middleware-fixture';

import { accountPasskeyCredentials, authIdentityFlows, authOperationGrants, db, userTotpEnrollments } from 'shared';

describe('reauthentication session authority', () => {
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
    const user = await identity();
    const app = appFor(user);
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
