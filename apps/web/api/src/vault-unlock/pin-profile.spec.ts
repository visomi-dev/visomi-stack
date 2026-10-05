import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import express, { json } from 'express';
import session from 'express-session';
import { DateTime } from 'luxon';
import request from 'supertest';

import { passport } from '../auth/passport';

import {
  authorizePinProfile,
  consumePinAttempt,
  readPinProfile,
  readPinMethodId,
  revokePinProfile,
} from './pin-profile';
import { vaultUnlockRouter } from './router';
import { closeVaultTestDatabase, migrateVaultTestDatabase } from './test-database';

import {
  accounts,
  accountMemberships,
  authOperationGrants,
  db,
  env,
  errorHandler,
  ManagedMemorySessionStore,
  users,
  vaultPinProfiles,
} from 'shared';
import type { VaultPinProfile } from 'shared-crypto';

const owners: { userId: string; accountId: string }[] = [];

beforeAll(migrateVaultTestDatabase, 30000);
afterAll(async () => {
  await closeVaultTestDatabase(owners);
});

async function fixture() {
  const owner = { userId: randomUUID(), accountId: randomUUID(), authVersion: 1 };

  owners.push(owner);

  await db.insert(users).values({ id: owner.userId, email: `${owner.userId}@example.test` });
  await db
    .insert(accounts)
    .values({ id: owner.accountId, ownerUserId: owner.userId, name: 'Workspace', slug: owner.accountId });
  await db
    .insert(accountMemberships)
    .values({ id: randomUUID(), accountId: owner.accountId, userId: owner.userId, role: 'owner' });
  const profile: VaultPinProfile = {
    version: 1,
    binding: { ownerUserId: owner.userId, personalScopeId: owner.accountId, methodId: randomUUID() },
    iv: 'A'.repeat(16),
    ciphertext: 'A'.repeat(64),
  };

  return { owner, profile };
}

describe('authoritative canonical vault PIN profile and shared attempt budget', () => {
  it('compares revisions and rejects foreign scope bindings without replacing the profile', async () => {
    const { owner, profile } = await fixture();

    await authorizePinProfile(owner, owner.accountId, null, profile);
    expect(await readPinProfile(owner, owner.accountId)).toEqual(profile);
    await expect(authorizePinProfile(owner, owner.accountId, null, profile)).rejects.toMatchObject({
      code: 'vault_pin_changed',
    });
    const next = { ...profile, binding: { ...profile.binding, methodId: randomUUID() } };

    await expect(
      authorizePinProfile(owner, owner.accountId, profile.binding.methodId, {
        ...next,
        binding: { ...next.binding, ownerUserId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'vault_binding_mismatch' });
    await authorizePinProfile(owner, owner.accountId, profile.binding.methodId, next);
    await expect(consumePinAttempt(owner, owner.accountId, profile.binding.methodId)).rejects.toMatchObject({
      code: 'vault_pin_changed',
    });
    expect(await readPinProfile(owner, owner.accountId)).toEqual(next);
  });

  it('serializes concurrent attempts and denies the sixth across callers without a client reset API', async () => {
    const { owner, profile } = await fixture();

    await authorizePinProfile(owner, owner.accountId, null, profile);
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => consumePinAttempt(owner, owner.accountId, profile.binding.methodId)),
    );

    expect(attempts.filter((item) => item.status === 'fulfilled')).toHaveLength(5);
    expect(attempts.filter((item) => item.status === 'rejected')).toHaveLength(3);
    const [record] = await db.select().from(vaultPinProfiles).where(eq(vaultPinProfiles.userId, owner.userId));

    expect(record.attempts).toBe(5);
    await expect(consumePinAttempt(owner, owner.accountId, profile.binding.methodId)).rejects.toMatchObject({
      code: 'vault_pin_cooldown',
    });
    await db
      .update(vaultPinProfiles)
      .set({ windowStartedAt: DateTime.utc().minus({ minutes: 11 }).toJSDate() })
      .where(eq(vaultPinProfiles.userId, owner.userId));
    expect((await consumePinAttempt(owner, owner.accountId, profile.binding.methodId)).remaining).toBe(4);
  });

  it('isolates users sharing an account and rejects stale membership/auth-version or a foreign account', async () => {
    const { owner, profile } = await fixture();
    const other = await fixture();

    await db
      .insert(accountMemberships)
      .values({ id: randomUUID(), accountId: owner.accountId, userId: other.owner.userId });
    await authorizePinProfile(owner, owner.accountId, null, profile);
    expect(await readPinProfile({ ...other.owner, accountId: owner.accountId }, owner.accountId)).toBeNull();
    await expect(readPinProfile(owner, other.owner.accountId)).rejects.toMatchObject({ code: 'vault_access_denied' });
    await expect(readPinProfile({ ...owner, authVersion: 2 }, owner.accountId)).rejects.toMatchObject({
      code: 'vault_access_denied',
    });
    await db.delete(accountMemberships).where(eq(accountMemberships.userId, owner.userId));
    await expect(readPinProfile(owner, owner.accountId)).rejects.toMatchObject({ code: 'vault_access_denied' });
    expect(await db.select().from(vaultPinProfiles).where(eq(vaultPinProfiles.userId, owner.userId))).toHaveLength(0);
  });

  it('revokes a profile idempotently and requires new setup instead of accepting stale local envelopes', async () => {
    const { owner, profile } = await fixture();

    await authorizePinProfile(owner, owner.accountId, null, profile);
    await expect(revokePinProfile(owner, owner.accountId, randomUUID())).rejects.toMatchObject({
      code: 'vault_pin_changed',
    });
    await revokePinProfile(owner, owner.accountId, profile.binding.methodId);
    await revokePinProfile(owner, owner.accountId, profile.binding.methodId);
    expect(await readPinProfile(owner, owner.accountId)).toEqual(profile);
    expect(await readPinMethodId(owner, owner.accountId)).toBeNull();
    await expect(consumePinAttempt(owner, owner.accountId, profile.binding.methodId)).rejects.toMatchObject({
      code: 'vault_pin_changed',
    });
  });

  it('requires a full session, CSRF and a single-use purpose-bound grant before publishing a profile', async () => {
    const { owner, profile } = await fixture();
    const store = new ManagedMemorySessionStore();
    const app = express();

    app.use(
      json(),
      session({
        store,
        secret: 'vault-test-secret',
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
        passport: {
          user: { id: owner.userId, accountId: owner.accountId, authVersion: 1, authority: req.session.authority },
        },
      });
      res.sendStatus(204);
    });
    app.use('/vault-unlock', vaultUnlockRouter);
    app.use(errorHandler);
    const agent = request.agent(app);

    agent.set('Origin', process.env['WEBAUTHN_ORIGIN'] ?? new URL(env.APP_BASE_URL).origin);
    await agent.post('/login').send({}).expect(204);
    const path = `/vault-unlock/${owner.accountId}`;
    const config = await agent.get(`${path}/config`).expect(200);

    expect(config.body.data.prf).toBe(env.VAULT_PRF_ENABLED);
    expect(config.body.data.browser).toBe(env.VAULT_BROWSER_ENABLED);
    if (!env.VAULT_BROWSER_ENABLED) {
      await agent.post(`${path}/browser-enrollments`).send({}).expect(503);
      await agent.get(`${path}/browser-enrollments/${randomUUID()}`).expect(503);
    }
    if (!env.VAULT_PRF_ENABLED) {
      await agent.get(`${path}/methods`).expect(503);
      await agent.post(`${path}/assertions/begin`).send({ purpose: 'unlock', methodId: randomUUID() }).expect(503);
    } else {
      expect((await agent.get(`${path}/methods`).expect(200)).body.data).toEqual([]);
    }
    const grantId = randomUUID();
    const input = { grantId, expectedMethodId: null, profile };

    await agent.post(`${path}/local-method`).send(input).expect(401);
    const sessions = await new Promise<Record<string, session.SessionData>>((resolve, reject) =>
      store.all((error, rows) => (error ? reject(error) : resolve(rows ?? {}))),
    );

    await db.insert(authOperationGrants).values({
      id: grantId,
      userId: owner.userId,
      purpose: 'vault_unlock_manage',
      sessionBinding: Object.keys(sessions)[0],
      verifiedAt: DateTime.utc().toJSDate(),
      expiresAt: DateTime.utc().plus({ minutes: 1 }).toJSDate(),
    });
    await agent.post(`${path}/local-method`).set('Origin', 'https://foreign.example').send(input).expect(403);
    await agent.post(`${path}/local-method`).send(input).expect(200);
    await agent.post(`${path}/local-method`).send(input).expect(401);
    const response = await agent.get(`${path}/pin-profile`).expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toEqual(profile);
    await agent.post('/login').send({ restricted: true }).expect(204);
    await agent.get(`${path}/pin-profile`).expect(403);
  });
});
