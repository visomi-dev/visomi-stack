import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import express, { json } from 'express';
import session from 'express-session';
import request from 'supertest';

import { passport } from '../auth/passport';
import { projectsRouter } from '../projects/projects-router';
import { createOpenApiDocument } from '../shared/http/openapi';

import { operationRouter } from './operation-router';

import {
  accountMemberships,
  accounts,
  asyncJobs,
  db,
  durableOperations,
  errorHandler,
  ManagedMemorySessionStore,
  projects,
  users,
} from 'shared';

jest.mock('../../../../../libs/backend/shared/src/lib/env', () => ({
  ...jest.requireActual('../../../../../libs/backend/shared/src/lib/env'),
  env: { ...jest.requireActual('../../../../../libs/backend/shared/src/lib/env').env, DATABASE_DRIVER: 'memory' },
}));

beforeAll(async () => {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
}, 30000);
afterAll(async () => {
  await (db as unknown as { $client: PGlite }).$client.close();
});

async function fixture() {
  const userId = randomUUID();
  const accountId = randomUUID();
  const projectId = randomUUID();

  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, emailVerifiedAt: new Date() });
  await db.insert(accounts).values({ id: accountId, ownerUserId: userId, name: 'Workspace', slug: accountId });
  await db.insert(accountMemberships).values({ id: randomUUID(), accountId, userId, role: 'owner' });
  await db
    .insert(projects)
    .values({ id: projectId, accountId, createdByUserId: userId, name: 'Project', slug: projectId });
  const store = new ManagedMemorySessionStore();
  const app = express();

  app.use(
    json(),
    session({ store, secret: 'test-operation-secret', resave: false, saveUninitialized: false }),
    passport.initialize(),
    passport.session(),
  );
  app.post('/login', (req, res) => {
    req.session.authority = 'full';
    Object.assign(req.session, { passport: { user: { id: userId, accountId, authVersion: 1, authority: 'full' } } });
    res.sendStatus(204);
  });
  app.use('/projects', projectsRouter);
  app.use('/operations', operationRouter);
  app.use(errorHandler);
  const agent = request.agent(app);

  await agent.post('/login').expect(204);

  return { app, agent, accountId, projectId, userId, store };
}

describe('operation HTTP contracts', () => {
  it('accepts once with a persisted feature job, serves uncached status and hides it from a different session', async () => {
    const { app, agent, projectId } = await fixture();
    const requestKey = randomUUID();
    const first = await agent.post(`/projects/${projectId}/seed`).set('Idempotency-Key', requestKey).expect(202);
    const second = await agent.post(`/projects/${projectId}/seed`).set('Idempotency-Key', requestKey).expect(202);

    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body.data.operation).toEqual(second.body.data.operation);
    expect(first.body.data.id).toBe(first.body.data.operation.operationId);
    const operationId = first.body.data.operation.operationId as string;
    const result = await agent.get(`/operations/${operationId}`).expect(200);

    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.data).toEqual({ operationId, status: 'pending' });
    expect(await db.select().from(asyncJobs)).toHaveLength(1);
    expect(await db.select().from(durableOperations)).toHaveLength(1);
    const otherSession = request.agent(app);

    await otherSession.post('/login').expect(204);
    await otherSession.get(`/operations/${operationId}`).expect(404);
    await request(app).get(`/operations/${operationId}`).expect(401);
    await agent.post(`/projects/${projectId}/seed`).set('Idempotency-Key', 'not-a-uuid').expect(400);
  });

  it('documents acceptance, idempotency and operation status without protected payload fields', () => {
    const document = createOpenApiDocument();

    expect(document.paths?.['/operations/{operationId}']?.get).toBeDefined();
    expect(document.paths?.['/projects/{projectId}/seed']?.post?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'idempotency-key', in: 'header' })]),
    );
    expect(JSON.stringify(document.paths?.['/operations/{operationId}'])).not.toContain('sessionId');
  });
});
