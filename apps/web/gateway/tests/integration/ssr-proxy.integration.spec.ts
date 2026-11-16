import { once } from 'node:events';
import { createServer, request as nodeRequest } from 'node:http';
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import { httpErrorHandler } from '@visomi-stack/web-backend-shared';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadApplication } from '../../src/application-module';
import type { AuthSnapshot } from '../../src/application-module';
// This Node-only SSR boundary cannot run in Angular's browser-only unit runner.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createSsrProxyPolicy } from '../../../app/src/ssr-proxy-policy';

const canonical = 'https://app.example.test';
const canonicalHeaders = {
  host: 'app.example.test',
  'x-forwarded-host': 'app.example.test',
  'x-forwarded-proto': 'https',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function request(server: ReturnType<typeof createServer>, headers: OutgoingHttpHeaders) {
  const rawHeaders = Object.entries(headers).flatMap(([name, value]) =>
    value === undefined ? [] : (Array.isArray(value) ? value : [value]).flatMap((entry) => [name, String(entry)]),
  );

  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const outgoing = nodeRequest(
      {
        host: '127.0.0.1',
        port: (server.address() as AddressInfo).port,
        path: '/app/en/foundations',
        headers: rawHeaders,
      },
      (response) => {
        let body = '';

        response.on('data', (chunk) => {
          body += String(chunk);
        });
        response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body }));
        response.on('error', reject);
      },
    );

    outgoing.on('error', reject);
    outgoing.end();
  });
}

async function application() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('AUTH_ORIGIN', canonical);
  vi.stubEnv('NG_ALLOWED_HOSTS', 'app.example.test');

  return loadApplication(new URL('../../../../../dist/apps/web/app/server/server.mjs', import.meta.url));
}

describe('SSR canonical proxy policy', () => {
  it.each([
    { NODE_ENV: 'development', AUTH_ORIGIN: canonical },
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', AUTH_ORIGIN: 'http://127.0.0.1:8080' },
    { NODE_ENV: 'production', AUTH_ORIGIN: 'http://localhost:8080' },
    { NODE_ENV: 'production', AUTH_ORIGIN: 'http://[::1]:8080' },
  ])('leaves direct/local rendering untrusted (%j)', (environment) => {
    expect(createSsrProxyPolicy(environment)).toBeUndefined();
  });

  it.each([
    'not-a-url',
    'http://app.example.test',
    'https://localhost',
    'https://user:synthetic@app.example.test',
    'https://app.example.test/other',
    'https://app.example.test/?private=synthetic',
    'https://app.example.test/#synthetic',
  ])('rejects invalid public origins without including their value in the error (%s)', (origin) => {
    expect(() => createSsrProxyPolicy({ NODE_ENV: 'production', AUTH_ORIGIN: origin })).toThrow(
      'ssr_public_origin_invalid',
    );
  });
});

describe('compiled SSR forwarded-header boundary', () => {
  it.each([
    ['valid origin', {}, 200],
    ['missing proto', { 'x-forwarded-proto': undefined }, 400],
    ['missing forwarded host', { 'x-forwarded-host': undefined }, 400],
    ['foreign forwarded host', { 'x-forwarded-host': 'attacker.invalid' }, 400],
    ['foreign raw host', { host: 'attacker.invalid' }, 400],
    ['loopback host', { 'x-forwarded-host': '127.0.0.1' }, 400],
    ['insecure proto', { 'x-forwarded-proto': 'http' }, 400],
    ['invalid proto', { 'x-forwarded-proto': 'javascript' }, 400],
    ['host list', { 'x-forwarded-host': 'app.example.test,attacker.invalid' }, 400],
    ['duplicate forwarded host', { 'x-forwarded-host': ['app.example.test', 'app.example.test'] }, 400],
    ['duplicate proto', { 'x-forwarded-proto': ['https', 'https'] }, 400],
    ['duplicate raw host', { host: ['app.example.test', 'app.example.test'] }, 400],
    ['foreign port', { 'x-forwarded-host': 'app.example.test:8080' }, 400],
    ['userinfo', { 'x-forwarded-host': 'user@app.example.test' }, 400],
    ['untrusted Forwarded', { forwarded: 'for=192.0.2.123;host=attacker.invalid;proto=http' }, 200],
    ['untrusted client address', { 'x-forwarded-for': '192.0.2.123' }, 200],
  ] as const)(
    'handles %s without logging the original claims',
    async (_label, overrides, expected) => {
      const module = await application();
      const parent = express();
      const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      parent.use(module.createApp({ errorMode: 'inherited', helmetMode: 'inherited' }));
      parent.use(httpErrorHandler);
      const server = parent.listen(0, '127.0.0.1');

      await once(server, 'listening');

      try {
        const headers = Object.fromEntries(
          Object.entries({ ...canonicalHeaders, ...overrides }).filter(([, value]) => value !== undefined),
        );
        const response = await request(server, headers as OutgoingHttpHeaders);

        expect(response.status).toBe(expected);

        if (expected === 200) {
          expect(response.body).toContain('ng-server-context="ssr"');
          expect(response.headers['cache-control']).toBe('no-store');
          expect(response.headers.etag).toBeUndefined();
        } else {
          expect(JSON.parse(response.body)).toEqual({ error: 'request_invalid' });
        }

        expect(warnings).not.toHaveBeenCalled();
        expect(errors).not.toHaveBeenCalled();
      } finally {
        server.closeAllConnections();

        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    },
    30000,
  );

  it('preserves original Express headers and per-request authentication during concurrent rendering', async () => {
    const module = await application();
    const seen: { cookie?: string; ip?: string; xff?: string | string[] }[] = [];
    const authContext = (incoming: express.Request) => {
      seen.push({ cookie: incoming.headers.cookie, ip: incoming.ip, xff: incoming.headers['x-forwarded-for'] });
      const owned = incoming.headers.cookie === 'session=synthetic_owner_secret';
      const session: AuthSnapshot = {
        authenticated: owned,
        user: owned ? { id: 'synthetic-owner-id', email: 'owner@example.test', emailVerified: true } : null,
        access: owned ? 'full' : 'anonymous',
        method: owned ? 'passkey' : null,
        nextStep: null,
      };

      return { available: true, session };
    };
    const parent = express();

    parent.use(
      module.createApp({ errorMode: 'inherited', helmetMode: 'inherited', trustProxy: ['loopback'], authContext }),
    );
    parent.use(httpErrorHandler);
    const server = parent.listen(0, '127.0.0.1');

    await once(server, 'listening');

    try {
      const [owner, anonymous, other] = await Promise.all([
        request(server, {
          ...canonicalHeaders,
          cookie: 'session=synthetic_owner_secret',
          'x-forwarded-for': '192.0.2.123',
        }),
        request(server, canonicalHeaders),
        request(server, { ...canonicalHeaders, cookie: 'session=synthetic_other_secret' }),
      ]);

      expect(owner.status).toBe(200);
      expect(owner.body).toContain('synthetic-owner-id');
      expect(owner.body).not.toContain('synthetic_owner_secret');
      expect(anonymous.status).toBe(200);
      expect(anonymous.body).not.toContain('synthetic-owner-id');
      expect(other.body).not.toContain('synthetic-owner-id');
      expect(seen).toContainEqual({ cookie: 'session=synthetic_owner_secret', ip: '192.0.2.123', xff: '192.0.2.123' });
    } finally {
      server.closeAllConnections();

      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  }, 30000);
});
