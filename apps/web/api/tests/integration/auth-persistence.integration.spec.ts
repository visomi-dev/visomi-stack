import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

import { authSchema, createDatabase } from '@visomi-stack/backend-shared';
import { eq, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { Cookie } from 'express-session';
import type { SessionData } from 'express-session';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticator } from '@visomi-stack/dev-testing';
import { testPostgres } from '@visomi-stack/dev-testing/postgres';

import { authConfig } from '../../src/auth/config';
import { Passkeys } from '../../src/auth/passkeys';
import { rateLimit } from '../../src/auth/security';
import { SessionStore } from '../../src/auth/session-store';

const { challenges, credentials, sessions, users } = authSchema;

let postgres: Awaited<ReturnType<typeof testPostgres>>;
let resource: ReturnType<typeof createDatabase>;
const execute = promisify(execFile);
const config = authConfig({
  origin: 'http://localhost:3307',
  rpId: 'localhost',
  secret: 'synthetic-32-byte-session-secret-key',
});

beforeAll(async () => {
  const isolated = await testPostgres();

  postgres = isolated;
  resource = createDatabase(postgres.url);
}, 20000);
afterAll(async () => {
  await resource?.close();
  await postgres?.stop();
});

function payload(): SessionData {
  const cookie = new Cookie();

  cookie.expires = new Date(Date.now() + 60000);

  return { cookie, csrf: 'synthetic-csrf' };
}

function save(store: SessionStore, sid: string, data = payload()) {
  return new Promise<void>((resolve, reject) => store.set(sid, data, (error) => (error ? reject(error) : resolve())));
}

function destroy(store: SessionStore, sid: string) {
  return new Promise<void>((resolve, reject) => store.destroy(sid, (error) => (error ? reject(error) : resolve())));
}

function read(store: SessionStore, sid: string) {
  return new Promise<SessionData | null | undefined>((resolve, reject) =>
    store.get(sid, (error, value) => (error ? reject(error) : resolve(value))),
  );
}

async function registeredPasskey() {
  const sid = randomUUID();
  const store = new SessionStore(resource.pool);
  const device = authenticator();
  const passkeys = new Passkeys(resource.db, config);

  await save(store, sid);
  const signup = await passkeys.registrationOptions(sid);
  const user = await passkeys.register(
    sid,
    signup.challengeId,
    device.register(signup.options.challenge, config.origin, config.rpId),
    'Synthetic passkey',
  );

  return { store, device, passkeys, user };
}

async function authenticationAttempt(
  fixture: Awaited<ReturnType<typeof registeredPasskey>>,
  counter: number,
  database = resource.db,
) {
  const sid = randomUUID();
  const passkeys = new Passkeys(database, config);

  await save(fixture.store, sid);
  const pending = await passkeys.authenticationOptions(sid);
  const response = fixture.device.authenticate(
    pending.options.challenge,
    config.origin,
    config.rpId,
    fixture.user.id,
    true,
    {
      counter,
    },
  );

  return { sid, pending, run: () => passkeys.authenticate(sid, pending.challengeId, response) };
}

describe('isolated PostgreSQL authentication persistence', () => {
  it('applies generated RC migrations and enforces identity, key and backup constraints', async () => {
    const userId = randomUUID();
    const credential = {
      id: randomUUID(),
      userId,
      credentialId: 'synthetic_credential',
      publicKey: 'synthetic_key',
      backupEligible: false,
      backupState: false,
      rpId: config.rpId,
    };

    await resource.db.insert(users).values({ id: userId });
    await resource.db.insert(credentials).values(credential);
    await expect(resource.db.insert(credentials).values({ ...credential, id: randomUUID() })).rejects.toThrow();
    await expect(
      resource.db
        .insert(credentials)
        .values({ ...credential, id: randomUUID(), credentialId: 'different', userId: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      resource.db
        .insert(credentials)
        .values({ ...credential, id: randomUUID(), credentialId: 'bad_backup', backupState: true }),
    ).rejects.toThrow();
    await expect(
      resource.db
        .insert(credentials)
        .values({ ...credential, id: randomUUID(), credentialId: 'bad_count', counter: -1 }),
    ).rejects.toThrow();
    const [persisted] = await resource.db.select().from(credentials).where(eq(credentials.id, credential.id));

    expect(persisted.userId).toBe(userId);
    expect(persisted.publicKey).toBe(credential.publicKey);
  });

  it('retains tombstones across store instances and concurrent delayed saves/touches', async () => {
    const first = new SessionStore(resource.pool);
    const sid = randomUUID();

    await save(first, sid);
    const stale = await read(first, sid);

    expect(stale).toBeTruthy();
    await destroy(first, sid);
    const second = new SessionStore(resource.pool);

    await Promise.all([save(second, sid, stale!), new Promise<void>((resolve) => second.touch(sid, stale!, resolve))]);
    const after = await read(second, sid);
    const [row] = await resource.db.select().from(sessions).where(eq(sessions.sid, sid));

    expect(after).toBeUndefined();
    expect(row.revokedAt).not.toBeNull();
    expect(row.sess).toEqual({});
    const unknown = randomUUID();

    await destroy(second, unknown);
    await save(first, unknown);
    const resurrected = await read(first, unknown);

    expect(resurrected).toBeUndefined();
    const racing = randomUUID();

    await Promise.all([save(first, racing), destroy(second, racing)]);
    await save(first, racing);
    const raced = await read(second, racing);

    expect(raced).toBeUndefined();
  });

  it('enforces absolute session lifetime and rejects delayed saves of expired sessions', async () => {
    const store = new SessionStore(resource.pool);
    const sid = randomUUID();
    const data = payload();

    data.cookie.expires = new Date(Date.now() + 24 * 60 * 60_000);
    await save(store, sid, data);
    const [bounded] = await resource.db.select().from(sessions).where(eq(sessions.sid, sid));

    expect(bounded.expire.getTime() - bounded.createdAt.getTime()).toBeLessThanOrEqual(8 * 60 * 60_000);
    await resource.db
      .update(sessions)
      .set({ expire: new Date(Date.now() - 1000) })
      .where(eq(sessions.sid, sid));
    await save(store, sid, data);
    const revived = await read(store, sid);

    expect(revived).toBeUndefined();
  });

  it('consumes a session-bound challenge only once across concurrent verifiers', async () => {
    const store = new SessionStore(resource.pool);
    const sid = randomUUID();
    const passkeys = new Passkeys(resource.db, config);

    await save(store, sid);
    const pending = await passkeys.authenticationOptions(sid);
    const results = await Promise.allSettled([
      passkeys.authenticate(sid, pending.challengeId, { id: 'missing', response: {} } as never),
      passkeys.authenticate(sid, pending.challengeId, { id: 'missing', response: {} } as never),
    ]);

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    const remaining = await resource.db.select().from(challenges).where(eq(challenges.id, pending.challengeId));
    const reasons = results.map((result) => (result.status === 'rejected' ? result.reason.code : 'fulfilled'));

    expect(remaining).toHaveLength(0);
    expect(reasons.sort()).toEqual(['challenge_invalid', 'passkey_invalid']);
  });

  it('rejects challenges from another session and expired challenges', async () => {
    const store = new SessionStore(resource.pool);
    const sid = randomUUID();
    const other = randomUUID();
    const passkeys = new Passkeys(resource.db, config);

    await save(store, sid);
    await save(store, other);
    const pending = await passkeys.authenticationOptions(sid);

    await expect(passkeys.authenticate(other, pending.challengeId, { id: 'missing' } as never)).rejects.toMatchObject({
      code: 'challenge_invalid',
    });
    await resource.db
      .update(challenges)
      .set({ createdAt: new Date(Date.now() - 10000), expiresAt: new Date(Date.now() - 1000) })
      .where(eq(challenges.id, pending.challengeId));
    await expect(passkeys.authenticate(sid, pending.challengeId, { id: 'missing' } as never)).rejects.toMatchObject({
      code: 'challenge_invalid',
    });
  });
  it('persists real WebAuthn credentials and rejects concurrent replay of the same challenge', async () => {
    const sid = randomUUID();
    const store = new SessionStore(resource.pool);
    const device = authenticator();
    const passkeys = new Passkeys(resource.db, config);

    await save(store, sid);
    const signup = await passkeys.registrationOptions(sid);
    const registered = await passkeys.register(
      sid,
      signup.challengeId,
      device.register(signup.options.challenge, config.origin, config.rpId),
      'Synthetic passkey',
    );
    const pending = await passkeys.authenticationOptions(sid);
    const assertion = device.authenticate(pending.options.challenge, config.origin, config.rpId, registered.id);
    const otherResource = createDatabase(postgres.url);

    try {
      const results = await Promise.allSettled([
        passkeys.authenticate(sid, pending.challengeId, assertion),
        new Passkeys(otherResource.db, config).authenticate(sid, pending.challengeId, assertion),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: { code: 'challenge_invalid' },
      });
      const [credential] = await resource.db
        .select()
        .from(credentials)
        .where(eq(credentials.id, registered.credentialId));

      expect(credential.counter).toBe(1);
      expect(credential.lastUsedAt).not.toBeNull();
      expect(credential.transports).toEqual(['internal']);
      expect(credential.backupEligible).toBe(false);
    } finally {
      await otherResource.close();
    }
  });

  it('serializes equal counters from independent sessions and challenges for one credential', async () => {
    const fixture = await registeredPasskey();
    const second = createDatabase(postgres.url);

    try {
      const firstAttempt = await authenticationAttempt(fixture, 1);
      const secondAttempt = await authenticationAttempt(fixture, 1, second.db);

      expect(firstAttempt.sid).not.toBe(secondAttempt.sid);
      expect(firstAttempt.pending.challengeId).not.toBe(secondAttempt.pending.challengeId);
      expect(firstAttempt.pending.options.challenge).not.toBe(secondAttempt.pending.options.challenge);
      const results = await Promise.allSettled([firstAttempt.run(), secondAttempt.run()]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: { code: 'passkey_invalid' },
      });
      const [persisted] = await resource.db
        .select()
        .from(credentials)
        .where(eq(credentials.id, fixture.user.credentialId));

      expect(persisted.counter).toBe(1);
      for (const attempt of [firstAttempt, secondAttempt]) {
        const pending = await resource.db
          .select()
          .from(challenges)
          .where(eq(challenges.id, attempt.pending.challengeId));

        expect(pending).toHaveLength(0);
      }
    } finally {
      await second.close();
    }
  });

  it('rejects an outdated counter while a fresh assertion runs, regardless of arrival order', async () => {
    const fixture = await registeredPasskey();
    const baseline = await authenticationAttempt(fixture, 5);

    await baseline.run();
    const second = createDatabase(postgres.url);

    try {
      const stale = await authenticationAttempt(fixture, 4);
      const fresh = await authenticationAttempt(fixture, 6, second.db);
      const [staleResult, freshResult] = await Promise.allSettled([stale.run(), fresh.run()]);

      expect(staleResult).toMatchObject({ status: 'rejected', reason: { code: 'passkey_invalid' } });
      expect(freshResult.status).toBe('fulfilled');
      const [persisted] = await resource.db
        .select()
        .from(credentials)
        .where(eq(credentials.id, fixture.user.credentialId));

      expect(persisted.counter).toBe(6);
      const regression = await authenticationAttempt(fixture, 5);

      await expect(regression.run()).rejects.toMatchObject({ code: 'passkey_invalid' });
      const [unchanged] = await resource.db
        .select()
        .from(credentials)
        .where(eq(credentials.id, fixture.user.credentialId));

      expect(unchanged.counter).toBe(6);
    } finally {
      await second.close();
    }
  });

  it.each(['userHandle', 'revoked', 'backupEligibility', 'backupState'] as const)(
    'rejects a signed assertion with invalid %s without updating its credential',
    async (invalid) => {
      const fixture = await registeredPasskey();
      const sid = randomUUID();

      await save(fixture.store, sid);
      const pending = await fixture.passkeys.authenticationOptions(sid);
      const response = fixture.device.authenticate(
        pending.options.challenge,
        config.origin,
        config.rpId,
        invalid === 'userHandle' ? randomUUID() : fixture.user.id,
        true,
        { backupEligible: invalid === 'backupEligibility', backupState: invalid === 'backupState' },
      );

      if (invalid === 'revoked') {
        await resource.db
          .update(credentials)
          .set({ revokedAt: new Date() })
          .where(eq(credentials.id, fixture.user.credentialId));
      }

      await expect(fixture.passkeys.authenticate(sid, pending.challengeId, response)).rejects.toMatchObject({
        code: 'passkey_invalid',
      });
      const [persisted] = await resource.db
        .select()
        .from(credentials)
        .where(eq(credentials.id, fixture.user.credentialId));
      const remaining = await resource.db.select().from(challenges).where(eq(challenges.id, pending.challengeId));

      expect(persisted.counter).toBe(0);
      expect(persisted.backupEligible).toBe(false);
      expect(persisted.backupState).toBe(false);
      expect(persisted.lastUsedAt).toBeNull();
      expect(remaining).toHaveLength(0);
    },
  );

  it('rolls back identity creation when a credential conflicts and consumes the failed challenge', async () => {
    const sid = randomUUID();
    const store = new SessionStore(resource.pool);
    const device = authenticator();
    const passkeys = new Passkeys(resource.db, config);

    await save(store, sid);
    const first = await passkeys.registrationOptions(sid);

    await passkeys.register(
      sid,
      first.challengeId,
      device.register(first.options.challenge, config.origin, config.rpId),
      'First',
    );
    const second = await passkeys.registrationOptions(sid);
    const before = await resource.db.select().from(users);

    await expect(
      passkeys.register(
        sid,
        second.challengeId,
        device.register(second.options.challenge, config.origin, config.rpId),
        'Conflicting',
      ),
    ).rejects.toThrow();
    const after = await resource.db.select().from(users);
    const challenge = await resource.db.select().from(challenges).where(eq(challenges.id, second.challengeId));

    expect(after).toHaveLength(before.length);
    expect(challenge).toHaveLength(0);
  });

  it.each(['origin', 'rp', 'verification'] as const)(
    'rejects a cryptographically constructed response with invalid %s',
    async (invalid) => {
      const sid = randomUUID();
      const store = new SessionStore(resource.pool);
      const device = authenticator();
      const passkeys = new Passkeys(resource.db, config);

      await save(store, sid);
      const signup = await passkeys.registrationOptions(sid);
      const response = device.register(
        signup.options.challenge,
        invalid === 'origin' ? 'https://other.example.test' : config.origin,
        invalid === 'rp' ? 'other.example.test' : config.rpId,
        invalid !== 'verification',
      );

      await expect(passkeys.register(sid, signup.challengeId, response, 'Invalid')).rejects.toMatchObject({
        code: 'passkey_invalid',
      });
      const remaining = await resource.db.select().from(challenges).where(eq(challenges.id, signup.challengeId));

      expect(remaining).toHaveLength(0);
    },
  );

  it('revokes sessions for a removed credential and rejects stale writes and logged-out mutations', async () => {
    const sid = randomUUID();
    const store = new SessionStore(resource.pool);
    const passkeys = new Passkeys(resource.db, config);
    const firstDevice = authenticator();
    const secondDevice = authenticator();

    await save(store, sid);
    const signup = await passkeys.registrationOptions(sid);
    const first = await passkeys.register(
      sid,
      signup.challengeId,
      firstDevice.register(signup.options.challenge, config.origin, config.rpId),
      'First',
    );
    const enrollment = await passkeys.registrationOptions(sid, first);
    const second = await passkeys.register(
      sid,
      enrollment.challengeId,
      secondDevice.register(enrollment.options.challenge, config.origin, config.rpId),
      'Second',
      first,
    );
    const oldSid = randomUUID();
    const stale = { ...payload(), passport: { user: first } };

    await save(store, oldSid, stale);
    const otherUser = { ...first, id: randomUUID(), credentialId: randomUUID() };
    const otherSid = randomUUID();
    const foreignReferenceSid = randomUUID();

    await resource.db.insert(users).values({ id: otherUser.id });
    await save(store, otherSid, { ...payload(), passport: { user: otherUser } });
    // Even an inconsistent snapshot cannot make one user revoke another user's session.
    await save(store, foreignReferenceSid, {
      ...payload(),
      passport: { user: { ...otherUser, credentialId: first.credentialId } },
    });
    await passkeys.revoke(sid, second, first.credentialId);
    await save(store, oldSid, stale);
    const persisted = await read(store, oldSid);

    expect(persisted).toBeUndefined();
    const otherSession = await read(store, otherSid);
    const foreignReference = await read(store, foreignReferenceSid);

    expect(otherSession?.passport?.user.id).toBe(otherUser.id);
    expect(foreignReference?.passport?.user.id).toBe(otherUser.id);
    await destroy(store, sid);
    await expect(passkeys.rename(sid, second, second.credentialId, 'Denied')).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('shares atomic rate-limit state across independent database clients', async () => {
    const second = createDatabase(postgres.url);
    const next = (database: typeof resource.db) =>
      new Promise<string | undefined>((resolve, reject) => {
        const work = rateLimit(database, config)(
          { method: 'POST', ip: 'synthetic-shared-address' } as Request,
          { setHeader: () => undefined } as unknown as Response,
          (error) => resolve(error?.code),
        );

        void Promise.resolve(work).catch(reject);
      });

    try {
      await resource.db.execute(sql`DELETE FROM auth_rate_limits`);
      const results = await Promise.all(
        Array.from({ length: 61 }, (_value, index) => next(index % 2 ? resource.db : second.db)),
      );

      expect(results.filter((result) => result === undefined)).toHaveLength(60);
      expect(results.filter((result) => result === 'rate_limited')).toHaveLength(1);
    } finally {
      await second.close();
    }
  });
  it('applies the explicit Drizzle Kit command to an empty dedicated database and reruns safely', async () => {
    await resource.pool.query('CREATE DATABASE visomi_auth_cli_test');
    const url = new URL(postgres.url);

    url.pathname = '/visomi_auth_cli_test';
    const command = () =>
      execute('pnpm', ['nx', 'run', 'backend-shared:db-migrate', '--output-style=static'], {
        cwd: resolve(__dirname, '../../../../..'),
        env: { ...process.env, DATABASE_URL: url.toString() },
        timeout: 20000,
      });

    await command();
    const migrated = createDatabase(url.toString());
    const id = randomUUID();

    try {
      await migrated.db.insert(users).values({ id });
      await command();
      const identities = await migrated.db.select().from(users);

      expect(identities.map((user) => user.id)).toEqual([id]);
    } finally {
      await migrated.close();
    }
  }, 30000);
});
