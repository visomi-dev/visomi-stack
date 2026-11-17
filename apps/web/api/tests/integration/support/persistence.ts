import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { authSchema, createDatabase } from '@visomi-stack/backend-db';
import { testPostgres } from '@visomi-stack/dev-testing/postgres';
import { createOperationId, syntheticHybridPolicy } from '@visomi-stack/shared-db';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';

import type { SessionActor } from '../../../src/access/service';
import { authConfig, createApp, createAuthentication } from '../../../src/app';
import { principal } from '../../../src/auth/shared/identity';

export let postgres: Awaited<ReturnType<typeof testPostgres>>;
export let resource: ReturnType<typeof createDatabase>;
let server: Server;

export let origin: string;
export const syntheticPersistenceSecret = 'synthetic-persistence-session-secret-32-bytes';
const secret = syntheticPersistenceSecret;

export const policy = structuredClone(syntheticHybridPolicy);

beforeEach(async () => {
  await resource.db.delete(authSchema.rateLimits);
});

type Target = { tenantId: string; scopeId: string };
type Client = {
  actor: SessionActor;
  browserAuth: { cookie: string; csrf: string };
  sendRaw(path: string, body: string): Promise<{ status: number; body: unknown }>;
  call(
    path: string,
    method?: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: Reply; cache: string | null }>;
};
type Reply = Target & { id: string; title: string; revision: number; items: Reply[]; next: string | null };

beforeAll(async () => {
  const response1 = await testPostgres();

  postgres = response1;
  resource = createDatabase(postgres.url);
  server = createServer();

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const config = authConfig({ origin, rpId: '127.0.0.1', secret });
  const auth = createAuthentication({ database: resource.db, pool: resource.pool, config });

  server.on('request', createApp({ auth, persistence: policy }));
}, 120_000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  await resource?.close();

  await postgres?.stop();
}, 120_000);

export async function client(): Promise<Client> {
  const id = randomUUID();
  const [user] = await resource.db
    .insert(authSchema.users)
    .values({ id, email: `${id}@example.test`, emailVerifiedAt: new Date(), passwordHash: 'synthetic-password-hash' })
    .returning();
  const current = principal(user, 'password');
  const sid = randomUUID();
  const csrf = randomUUID();
  const expires = new Date(Date.now() + 3_600_000);

  await resource.db.insert(authSchema.sessions).values({
    sid,
    expire: expires,
    sess: {
      cookie: {
        originalMaxAge: 3_600_000,
        expires: expires.toISOString(),
        httpOnly: true,
        path: '/',
        sameSite: 'strict',
      },
      csrf,
      passport: { user: current },
    },
  });

  const signature = createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  const cookie = `visomi.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;

  return {
    actor: { sessionId: sid, principal: current },
    browserAuth: { cookie: cookie.slice('visomi.sid='.length), csrf },
    async sendRaw(path, body) {
      const response = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { cookie, origin, 'x-csrf-token': csrf, 'content-type': 'application/json' },
        body,
      });
      const parsed: unknown = await response.json();

      return { status: response.status, body: parsed };
    },
    async call(path, method = 'GET', body, headers = {}) {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: {
          cookie,
          origin,
          'x-csrf-token': csrf,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      const response2 = await response.json();

      return { status: response.status, body: response2, cache: response.headers.get('cache-control') };
    },
  };
}

export const base = (target: Target) => `/persistence/tenants/${target.tenantId}/scopes/${target.scopeId}`;
export const collection = (target: Target, domain = 'operations') => `${base(target)}/domains/${domain}/records`;
export const mutation = (title = 'Synthetic record', audience = 'owner') => ({
  kind: 'create',
  operationId: createOperationId(globalThis.crypto),
  title,
  body: 'Synthetic server-readable content',
  audience,
});

export async function fixture() {
  const owner = await client();
  const member = await client();
  const outsider = await client();
  const created = await owner.call('/persistence/tenants', 'POST', {});

  expect(created.status).toBe(200);
  const tenant = created.body as Target;
  const group = await owner.call(`${base(tenant)}/children`, 'POST', { kind: 'group' });
  const scope = await owner.call(`${base(group.body)}/children`, 'POST', { kind: 'resource' });

  expect(group.status).toBe(200);
  expect(scope.status).toBe(200);
  const response3 = await owner.call(`${base(tenant)}/members`, 'PUT', {
    userId: member.actor.principal.id,
    active: true,
  });

  expect(response3.status).toBe(200);

  return { owner, member, outsider, tenant, group: group.body as Target, target: scope.body as Target };
}

export async function grant(f: Awaited<ReturnType<typeof fixture>>, role: string, target = f.target) {
  const result = await f.owner.call(`${base(target)}/grants`, 'PUT', { userId: f.member.actor.principal.id, role });

  expect(result.status).toBe(200);
}
