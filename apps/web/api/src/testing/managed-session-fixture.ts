import type { Server } from 'node:http';

import type { PGlite } from '@electric-sql/pglite';
import express, { json, type Router } from 'express';
import session from 'express-session';
import { Passport } from 'passport';
import request from 'supertest';

import { db, errorHandler, ManagedMemorySessionStore } from 'shared';

export function managedSessionFixture() {
  const database = (db as unknown as { $client: PGlite }).$client;
  const servers: Server[] = [];

  beforeAll(async () => {
    await database.exec('CREATE TABLE users (id text PRIMARY KEY, auth_version integer NOT NULL)');
  }, 30000);
  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
    await database.exec('DELETE FROM users');
  });
  afterAll(async () => {
    await database.close();
  });

  return async function authenticatedAgent(path: string, router: Router, accountId: string, userId: string) {
    const user: Express.User = {
      id: userId,
      accountId,
      email: `${userId}@example.test`,
      emailVerifiedAt: null,
      role: 'owner',
      authority: 'full',
      authVersion: 1,
    };

    await database.query('INSERT INTO users (id, auth_version) VALUES ($1, 1) ON CONFLICT (id) DO NOTHING', [userId]);
    const app = express();
    const passport = new Passport();

    passport.serializeUser<Express.User>((identity, done) => done(null, identity));
    passport.deserializeUser<Express.User>((identity, done) => done(null, identity));
    app.use(
      json(),
      session({
        secret: 'managed-router-test-secret',
        resave: false,
        saveUninitialized: false,
        store: new ManagedMemorySessionStore(),
      }),
      passport.initialize(),
      passport.session(),
    );
    app.post('/login', (req, res, next) => {
      req.login(user, (error) => {
        if (error) return next(error);
        req.session.authority = 'full';
        res.sendStatus(204);
      });
    });
    app.use(path, router);
    app.use(errorHandler);
    const server = app.listen(0);

    servers.push(server);
    const agent = request.agent(server);

    await agent.post('/login').expect(204);

    return agent;
  };
}
