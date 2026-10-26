import { createServer } from 'node:http';
import { resolve } from 'node:path';

import { httpErrorHandler, securityHeaders } from '@visomi-stack/web-backend-shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import express from 'express';
import { authenticator } from '@visomi-stack/dev-testing';

import { expect, authTest as test } from './fixtures/http';
import { testDatabasePool } from './support/database';

const { createApp, authConfig, createAuthentication } = require(
  resolve(__dirname, '../../../../dist/apps/web/api/app'),
) as typeof import('../src/app');
const origin = 'http://127.0.0.1:3307';

async function parentHost(initialize: boolean, options: { origin?: string; trustProxy?: string[] } = {}) {
  const pool = await testDatabasePool();
  const auth = createAuthentication({
    pool,
    database: drizzle({ client: pool, logger: false }),
    config: authConfig({
      origin: options.origin ?? origin,
      rpId: new URL(options.origin ?? origin).hostname,
      secret: 'synthetic-e2e-only-session-secret-32-bytes',
    }),
  });
  const parent = express();

  parent.use(securityHeaders());
  parent.use((_request, response, next) => {
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    next();
  });

  if (options.trustProxy) {
    parent.set('trust proxy', options.trustProxy);
  }

  if (initialize) {
    parent.use(auth.middleware);
  }

  parent.use('/api', createApp({ auth, authMode: 'inherited', errorMode: 'inherited', helmetMode: 'inherited' }));
  parent.use(httpErrorHandler);
  const server = createServer(parent);

  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('parent_fixture_port_unavailable');
  }

  return {
    pool,
    origin: `http://127.0.0.1:${address.port}/api`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((closed) => server.close(() => closed()));
      await pool.end();
    },
  };
}

test('an inherited API uses its real parent session/Passport chain and preserves route protection', async ({
  request,
}) => {
  const host = await parentHost(true);

  try {
    const response = await request.get(`${host.origin}/auth/session`);
    const state = await response.json();
    const protectedResponse = await request.get(`${host.origin}/auth/passkeys`);

    expect(response.status()).toBe(200);
    expect(state.authenticated).toBe(false);
    expect(protectedResponse.status()).toBe(401);
    expect(response.headers()['content-security-policy']).toBe("default-src 'none'");
    expect(protectedResponse.headers()['content-security-policy']).toBe("default-src 'none'");
    expect(protectedResponse.headers()['x-content-type-options']).toBe('nosniff');
    const denied = await protectedResponse.json();

    expect(denied).toEqual({ error: 'authentication_required' });
    const begin = await request.post(`${host.origin}/auth/passkeys/registration/options`, {
      headers: { origin, 'x-csrf-token': state.csrfToken },
      data: {},
    });
    const pending = await begin.json();
    const device = authenticator();
    const verification = await request.post(`${host.origin}/auth/passkeys/registration/verify`, {
      headers: { origin, 'x-csrf-token': state.csrfToken },
      data: {
        challengeId: pending.challengeId,
        response: device.register(pending.options.challenge, origin, '127.0.0.1'),
      },
    });
    const authorized = await request.get(`${host.origin}/auth/passkeys`);
    const livePool = await host.pool.query('SELECT 1 AS alive');

    expect(verification.status()).toBe(201);
    expect(authorized.status()).toBe(200);
    expect(livePool.rows[0].alive).toBe(1);
  } finally {
    await host.close();
  }
});

test('an inherited API fails clearly when its parent did not initialize authentication', async ({ request }) => {
  const host = await parentHost(false);

  try {
    const response = await request.get(`${host.origin}/auth/session`);
    const body = await response.json();

    expect(response.status()).toBe(503);
    expect(body).toEqual({ error: 'auth_initialization_missing' });
  } finally {
    await host.close();
  }
});

test('sets production cookie protections only when TLS forwarding comes from a trusted proxy', async ({ request }) => {
  const trusted = await parentHost(true, { origin: 'https://api.example.test', trustProxy: ['127.0.0.1'] });
  const untrusted = await parentHost(true, { origin: 'https://api.example.test' });

  try {
    const secure = await request.get(`${trusted.origin}/auth/session`, { headers: { 'x-forwarded-proto': 'https' } });
    const ignored = await request.get(`${untrusted.origin}/auth/session`, {
      headers: { 'x-forwarded-proto': 'https' },
    });
    const cookie = secure.headers()['set-cookie'];

    expect(secure.status()).toBe(200);
    expect(cookie).toContain('__Host-visomi.sid=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
    expect(ignored.headers()['set-cookie']).toBeUndefined();
  } finally {
    await trusted.close();
    await untrusted.close();
  }
});
