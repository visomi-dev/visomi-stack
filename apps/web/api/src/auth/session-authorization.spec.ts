import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { PGlite } from '@electric-sql/pglite';
import express, { json } from 'express';
import session, { MemoryStore } from 'express-session';
import { Passport } from 'passport';
import request from 'supertest';

import { authed } from './auth-middleware';
import { establishFullSession } from './auth-session';

import { db, errorHandler, HttpError, ManagedMemorySessionStore } from 'shared';

jest.mock('shared', () => {
  const actual = jest.requireActual('shared');
  const { PGlite } = jest.requireActual('@electric-sql/pglite');
  const { drizzle } = jest.requireActual('drizzle-orm/pglite');

  return { ...actual, db: drizzle(new PGlite(), { casing: 'snake_case' }) };
});

const database = (db as unknown as { $client: PGlite }).$client;
const servers: Server[] = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

async function fixture(
  options: { before?: boolean; inside?: boolean; unsupported?: boolean; restricted?: boolean } = {},
) {
  const user: Express.User = {
    id: randomUUID(),
    accountId: 'account',
    email: 'lease@example.test',
    emailVerifiedAt: null,
    role: 'owner',
    authority: 'full',
    authVersion: 1,
  };

  await database.query('INSERT INTO users (id, auth_version) VALUES ($1, 1)', [user.id]);
  const store = new ManagedMemorySessionStore();
  const app = express();
  const passport = new Passport();
  const loaded = deferred();
  const enter = deferred();
  const proceed = deferred();
  const commit = deferred();
  const events: string[] = [];

  passport.serializeUser<Express.User>((identity, done) => done(null, identity));
  // Deliberately deserialize the prior snapshot; the lease must recheck the authoritative DB version.
  passport.deserializeUser<Express.User>((identity, done) => done(null, identity));
  app.use(
    json(),
    session({
      secret: 'session-authority-test-secret',
      resave: false,
      saveUninitialized: false,
      store: options.unsupported ? new MemoryStore() : store,
    }),
  );
  app.use(passport.initialize(), passport.session());
  app.post('/login', (req, res, next) => {
    const restricted = options.restricted && req.body?.restricted;

    req.login({ ...user, authority: restricted ? 'restricted' : 'full' }, (error) => {
      if (error) return next(error);
      req.session.authority = restricted ? 'restricted' : 'full';
      req.session.passkeySecurityReauthenticatedAt = Date.now();
      if (restricted) {
        req.session.restrictedAuth = {
          allowedOperations: ['passkeys:enroll', 'passkeys:verify'],
          eligibleAccounts: [],
          expiresAt: Date.now() + 60_000,
          flowId: 'promotion',
          issuedAt: Date.now(),
          isNewUser: false,
          purpose: 'bootstrap_recovery',
          selectedAccountId: user.accountId,
          userId: user.id,
          verifiedEmail: user.email,
        };
      }
      res.json({ sid: req.sessionID });
    });
  });
  app.post(
    '/mutate',
    async (_req, _res, next) => {
      loaded.resolve();
      if (options.before) await proceed.promise;
      next();
    },
    authed({ authority: 'full' }),
    async (_req, res) => {
      enter.resolve();
      if (options.inside) await commit.promise;
      await database.query('UPDATE users SET email = $2 WHERE id = $1', [user.id, 'changed@example.test']);
      events.push('committed');
      res.sendStatus(204);
    },
  );
  app.post('/revoke', authed({ authority: 'full' }), async (req, res) => {
    const revoked = await store.revokeManagedSessions({
      userId: user.id,
      authVersion: 1,
      currentSid: req.sessionID,
      secret: 'test-management-secret',
    });

    events.push('revoked');
    res.json({ revoked });
  });
  app.post('/end', authed({ authority: 'full' }), async (req, res) => {
    await new Promise<void>((resolve, reject) => req.session.destroy((error) => (error ? reject(error) : resolve())));
    res.sendStatus(204);
  });
  app.post('/rotate', authed({ authority: 'full' }), async (req, res) => {
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    await new Promise<void>((resolve, reject) => req.login(user, (error) => (error ? reject(error) : resolve())));
    req.session.authority = 'full';
    res.json({ sid: req.sessionID });
  });
  app.post('/promote', authed(), async (req, res) => {
    await establishFullSession(req, res, {
      ...user,
      authority: 'full',
      authenticationMethod: 'passkey',
      authVersion: 1,
    });
    res.json({ sid: req.sessionID });
  });
  app.post('/consume', authed({ authority: 'full' }), async (req, res) => {
    delete req.session.passkeySecurityReauthenticatedAt;
    enter.resolve();
    await commit.promise;
    events.push('consumed');
    res.sendStatus(204);
  });
  app.post('/reuse', authed({ authority: 'full' }), (req, res) => {
    if (!req.session.passkeySecurityReauthenticatedAt) {
      throw new HttpError({ code: 'reauthentication_required', message: 'Reauthenticate.', statusCode: 401 });
    }
    res.sendStatus(204);
  });
  app.post(
    '/guarded',
    (_req, _res, next) => {
      loaded.resolve();
      next();
    },
    authed(options.restricted ? undefined : { authority: 'full', roles: ['owner'] }),
    (_req, res) => res.sendStatus(204),
  );
  app.post(
    '/nested',
    authed({ authority: 'full' }),
    (req, _res, next) => {
      req.session.reauthGrantId = 'new-grant';
      next();
    },
    authed({ authority: 'full' }),
    (req, res) => res.json({ grant: req.session.reauthGrantId }),
  );
  app.use(errorHandler);
  const server = app.listen(0);

  servers.push(server);
  const actor = request.agent(server);
  const controller = request.agent(server);
  const actorLogin = await actor.post('/login').send({ restricted: options.restricted }).expect(200);
  const controllerLogin = await controller.post('/login').expect(200);

  return {
    app,
    actor,
    controller,
    store,
    user,
    loaded,
    enter,
    proceed,
    commit,
    events,
    actorSid: String(actorLogin.body.sid),
    controllerSid: String(controllerLogin.body.sid),
  };
}

beforeAll(async () => {
  await database.exec(
    "CREATE TABLE users (id text PRIMARY KEY, auth_version integer NOT NULL, email text NOT NULL DEFAULT '')",
  );
}, 30000);
afterAll(async () => {
  await database.close();
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

describe('authenticated mutation authority boundary', () => {
  it('does not restore consumed reauthentication from a preloaded same-SID waiting request', async () => {
    const test = await fixture();
    const consume = test.actor.post('/consume').then((response) => response);

    await test.enter.promise;
    const waiting = test.actor.post('/mutate').then((response) => response);

    await test.loaded.promise;
    test.commit.resolve();
    expect((await consume).status).toBe(204);
    expect((await waiting).status).toBe(204);
    expect(test.events).toEqual(['consumed', 'committed']);
    const response = await test.actor.post('/reuse').expect(401);

    expect(response.body.code).toBe('reauthentication_required');
    const stored = await new Promise<session.SessionData | null | undefined>((resolve, reject) =>
      test.store.get(test.actorSid, (error, data) => (error ? reject(error) : resolve(data))),
    );

    expect(stored?.passkeySecurityReauthenticatedAt).toBeUndefined();
  });

  it.each(['role', 'authority', 'restricted expiry'] as const)(
    'rechecks %s after reloading a waiting request',
    async (change) => {
      const test = await fixture({ restricted: change === 'restricted expiry' });
      const locked = deferred();
      const unlock = deferred();
      const holder = test.store.withSessionAuthority(
        {
          userId: test.user.id,
          authVersion: 1,
          currentSid: test.actorSid,
          authority: change === 'restricted expiry' ? 'restricted' : 'full',
        },
        async () => {
          locked.resolve();
          await unlock.promise;
          const data = await new Promise<session.SessionData | null | undefined>((resolve, reject) =>
            test.store.get(test.actorSid, (error, data) => (error ? reject(error) : resolve(data))),
          );

          if (!data?.passport?.user) throw new Error('Missing fixture identity');
          if (change === 'role') Object.assign(data.passport.user, { role: 'member' });
          else if (change === 'authority') data.passport.user.authority = 'restricted';
          else {
            if (!data.restrictedAuth) throw new Error('Missing restricted fixture');
            data.restrictedAuth.expiresAt = 0;
          }
          await new Promise<void>((resolve, reject) =>
            test.store.set(test.actorSid, data, (error) => (error ? reject(error) : resolve())),
          );
        },
      );

      await locked.promise;
      const waiting = test.actor.post('/guarded').then((response) => response);

      await test.loaded.promise;
      unlock.resolve();
      await holder;
      const response = await waiting;

      expect(response.status).toBe(change === 'role' ? 403 : 401);
      expect(response.body.code).toBe(change === 'role' ? 'forbidden' : 'restricted_session_required');
    },
  );

  it('preserves mutations made within the lease through nested guards', async () => {
    const test = await fixture();
    const response = await test.actor.post('/nested').expect(200);

    expect(response.body.grant).toBe('new-grant');
  });

  it.each(['/promote', '/rotate'])('holds authority through a delayed complete session write for %s', async (path) => {
    const test = await fixture({ restricted: path === '/promote' });
    const writing = deferred();
    const persist = deferred();
    const originalSet = test.store.set.bind(test.store);
    let delayed = false;

    jest.spyOn(test.store, 'set').mockImplementation((sid, data, callback) => {
      if (!delayed && sid !== test.actorSid && data.authority === 'full') {
        delayed = true;
        writing.resolve();
        void persist.promise.then(() => {
          originalSet(sid, data, callback);
          test.events.push('persisted');
        });
      } else originalSet(sid, data, callback);
    });
    const promotion = test.actor.post(path).then((response) => response);

    await writing.promise;
    const revocation = test.store
      .revokeManagedSessions({
        userId: test.user.id,
        authVersion: 1,
        currentSid: test.controllerSid,
        secret: 'test-management-secret',
      })
      .then((count) => {
        test.events.push('revoked');

        return count;
      });

    try {
      expect(
        await Promise.race([
          revocation.then(() => 'revoked'),
          new Promise<string>((resolve) => setImmediate(() => resolve('pending'))),
        ]),
      ).toBe('pending');
    } finally {
      persist.resolve();
    }
    const response = await promotion;

    expect(response.status).toBe(200);
    expect(response.body.sid).not.toBe(test.actorSid);
    expect(await revocation).toBe(1);
    expect(test.events).toEqual(['persisted', 'revoked']);
    await test.actor.post('/mutate').expect(401);
  });

  it('rejects an already-loaded request after another session revokes it', async () => {
    const test = await fixture({ before: true });
    const mutation = test.actor.post('/mutate').then((response) => response);

    await test.loaded.promise;
    try {
      const revoked = await test.controller.post('/revoke').expect(200);

      expect(revoked.body.revoked).toBe(1);
    } finally {
      test.proceed.resolve();
    }
    expect((await mutation).status).toBe(401);
    expect(test.events).toEqual(['revoked']);
    expect(
      (await database.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [test.user.id])).rows[0].email,
    ).toBe('');
  });

  it('keeps revocation pending until a deferred admitted mutation finishes', async () => {
    const test = await fixture({ inside: true });
    const mutation = test.actor.post('/mutate').then((response) => response);

    await test.enter.promise;
    const revoke = test.controller.post('/revoke').then((response) => response);

    await new Promise<void>((resolve) => setImmediate(resolve));
    test.commit.resolve();
    expect((await mutation).status).toBe(204);
    expect((await revoke).status).toBe(200);
    expect(test.events).toEqual(['committed', 'revoked']);
    expect(
      (await database.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [test.user.id])).rows[0].email,
    ).toBe('changed@example.test');
  });

  it('does not release authority on socket cancellation while the handler can still commit', async () => {
    const test = await fixture({ inside: true });
    const pending = test.actor.post('/mutate');
    const mutation = pending.then(
      (response) => response,
      () => undefined,
    );

    await test.enter.promise;
    pending.abort();
    const revoke = test.controller.post('/revoke').then((response) => response);

    await new Promise<void>((resolve) => setImmediate(resolve));
    test.commit.resolve();
    await mutation;
    expect((await revoke).status).toBe(200);
    expect(test.events).toEqual(['committed', 'revoked']);
  });

  it('rechecks authVersion after waiting for a competing authority lease', async () => {
    const test = await fixture();
    const locked = deferred();
    const unlock = deferred();
    const holder = test.store.withSessionAuthority(
      { userId: test.user.id, authVersion: 1, currentSid: test.controllerSid },
      async () => {
        locked.resolve();
        await unlock.promise;
        await database.query('UPDATE users SET auth_version = 2 WHERE id = $1', [test.user.id]);
      },
    );

    await locked.promise;
    const mutation = test.actor.post('/mutate').then((response) => response);

    await test.loaded.promise;
    unlock.resolve();
    await holder;
    expect((await mutation).status).toBe(401);
    expect(test.events).toEqual([]);
  });

  it('allows same-request session destruction before ending the response without deadlocking', async () => {
    const test = await fixture();

    await test.actor.post('/end').expect(204);
    await test.actor.post('/mutate').expect(401);
  });

  it('propagates a final save failure and releases the lease for revocation', async () => {
    const test = await fixture();

    jest.spyOn(test.store, 'set').mockImplementationOnce((_sid, _data, callback) => {
      setImmediate(() => callback?.(new Error('Session persistence failed')));
    });
    await test.actor.post('/mutate').expect(500);
    const response = await test.controller.post('/revoke').expect(200);

    expect(response.body.revoked).toBe(1);
  });

  it('fails closed for unsupported stores', async () => {
    const test = await fixture({ unsupported: true });

    await test.actor.post('/mutate').expect(503);
    expect(test.events).toEqual([]);
  });

  it('preserves session regeneration while keeping the previous SID revoked', async () => {
    const test = await fixture();
    const rotated = await test.actor.post('/rotate').expect(200);

    expect(rotated.body.sid).not.toBe(test.actorSid);
    await test.actor.post('/mutate').expect(204);
    await expect(
      test.store.withSessionAuthority(
        { userId: test.user.id, authVersion: 1, currentSid: test.actorSid },
        async () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'session_authority_invalid' });
  });
});
