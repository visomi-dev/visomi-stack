import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

import { createDatabase } from '@visomi-stack/backend-shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadApi } from '../../src/api-module';
import { authenticator } from '../../../../../tests/support/authenticator';
import { testPostgres } from '../../../../../tests/support/postgres';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../../..');
const output = join(root, 'dist/apps/web/gateway');
let directory: string;
let postgres: Awaited<ReturnType<typeof testPostgres>>;
let probe: ReturnType<typeof createDatabase>;

beforeAll(async () => {
  await mkdir(join(root, 'tmp/api-e2e'), { recursive: true });
  const temporary = await mkdtemp(join(root, 'tmp/api-e2e/gateway-'));
  const cluster = await testPostgres(join(temporary, 'postgres.json'));

  directory = temporary;
  postgres = cluster;
  probe = createDatabase(postgres.url);
}, 20000);

afterAll(async () => {
  await probe?.close();
  await postgres?.stop();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function launch(databaseUrl?: string) {
  const portProbe = createServer();

  await new Promise<void>((ready) => portProbe.listen(0, '127.0.0.1', ready));
  const address = portProbe.address();

  if (!address || typeof address === 'string') {
    throw new Error('gateway_test_port_unavailable');
  }

  await new Promise<void>((closed) => portProbe.close(() => closed()));
  const url = `http://127.0.0.1:${address.port}`;
  const child = spawn(process.execPath, [join(output, 'main.js')], {
    cwd: directory,
    env: {
      HOST: '127.0.0.1',
      PORT: String(address.port),
      NODE_ENV: 'test',
      ...(databaseUrl
        ? {
            DATABASE_URL: databaseUrl,
            AUTH_ORIGIN: url,
            AUTH_RP_ID: '127.0.0.1',
            SESSION_SECRET: 'synthetic-gateway-session-secret-32-bytes',
          }
        : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exit = once(child, 'exit');
  let logs = '';

  child.stdout.on('data', (chunk) => {
    logs += String(chunk);
  });
  // Drain stderr without exposing dependency warnings or test diagnostics in telemetry.
  child.stderr.on('data', () => undefined);
  const cleanup = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exit;
    }
  };

  try {
    await new Promise<void>((ready, reject) => {
      const deadline = setTimeout(() => reject(new Error('gateway_test_startup_timeout')), 5000);

      child.once('error', reject);
      child.once('exit', () => {
        clearTimeout(deadline);
        reject(new Error('gateway_test_startup_failed'));
      });
      child.stdout.on('data', () => {
        if (logs.includes('"event":"runtime.started"')) {
          clearTimeout(deadline);
          ready();
        }
      });
    });
  } catch (error) {
    await cleanup();

    throw error;
  }

  return {
    url,
    cleanup,
    async stop(signal: NodeJS.Signals) {
      child.kill(signal);
      const [code] = await exit;

      return {
        code,
        events: logs
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      };
    },
  };
}

describe('compiled ESM gateway and embedded API', () => {
  it('loads the actual compiled API through the gateway module boundary without starting it', async () => {
    const api = await loadApi(pathToFileURL(join(root, 'dist/apps/web/api/app.js')));

    expect(api.createApp).toBeTypeOf('function');
    expect(api.authConfig).toBeTypeOf('function');
    expect(api.createAuthentication).toBeTypeOf('function');
  });
  it('exports an import-safe ESM app with runtime metadata and no bundled API source', async () => {
    const script = `
      import net from 'node:net';
      let listens = 0, connections = 0, intervals = 0;
      const signals = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT');
      net.Server.prototype.listen = () => { listens++; throw new Error('unexpected listener'); };
      net.Socket.prototype.connect = () => { connections++; throw new Error('unexpected connection'); };
      global.setInterval = () => { intervals++; throw new Error('unexpected interval'); };
      const app = await import(${JSON.stringify(pathToFileURL(join(output, 'app.js')).href)});
      app.createGatewayApp({ api: { createApp: () => (_request, _response, next) => next() } });
      console.log(JSON.stringify({ listens, connections, intervals,
        signals: process.listenerCount('SIGTERM') + process.listenerCount('SIGINT') - signals,
        exports: Object.keys(app).sort() }));
    `;
    const result = await execute(process.execPath, ['--input-type=module', '-e', script], {
      cwd: directory,
      timeout: 5000,
    });

    expect(JSON.parse(result.stdout)).toEqual({
      listens: 0,
      connections: 0,
      intervals: 0,
      signals: 0,
      exports: ['createGatewayApp'],
    });
    const metadataFile = await readFile(join(output, 'package.json'), 'utf8');
    const metadata = JSON.parse(metadataFile);

    expect(metadata.type).toBe('module');
    expect(metadata.exports).toEqual({ '.': './app.js', './app': './app.js' });
    expect(metadata.dependencies.pg).toBe('8.23.1');
    expect(metadata.dependencies['drizzle-orm']).toBe('1.0.0-rc.5');
    expect(metadata.dependencies.helmet).toBe('8.3.0');
    const mapFile = await readFile(join(output, 'main.js.map'), 'utf8');
    const map = JSON.parse(mapFile);

    expect(map.sources.some((source: string) => /api\/src\//.test(source))).toBe(false);
    expect(map.sources.some((source: string) => /\.(spec|test)\./.test(source))).toBe(false);
  });

  it.each(['SIGTERM', 'SIGINT'] as const)('mounts /api from its sibling artifact and drains on %s', async (signal) => {
    const gateway = await launch();

    try {
      const paths = ['/api/', '/api/auth/session', '/api/missing', '/'];
      const responses = await Promise.all(paths.map((path) => fetch(gateway.url + path)));

      expect(responses.map((response) => response.status)).toEqual([200, 503, 404, 404]);
      for (const response of responses) {
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
        expect(response.headers.has('strict-transport-security')).toBe(false);
      }
      const ids = responses.map((response) => response.headers.get('x-request-id'));

      expect(new Set(ids).size).toBe(paths.length);
      const greeting = await responses[0].json();

      expect(greeting).toEqual({ message: 'Hello API' });
      const result = await gateway.stop(signal);
      const requests = result.events.filter((event) => event.event === 'http.request');

      expect(result.code).toBe(0);
      expect(requests).toHaveLength(paths.length);
      expect(result.events.every((event) => event.service === 'web-gateway')).toBe(true);
      expect(result.events.filter((event) => event.event === 'runtime.started')).toHaveLength(1);
      expect(result.events.filter((event) => event.event === 'runtime.stopped')).toHaveLength(1);
    } finally {
      await gateway.cleanup();
    }
  });

  it('uses one inherited auth chain with real PostgreSQL, valid WebAuthn and owned-pool cleanup', async () => {
    const name = 'gateway_' + randomUUID();
    const connection = new URL(postgres.url);

    connection.searchParams.set('application_name', name);
    const gateway = await launch(connection.toString());
    const device = authenticator();
    let cookie = '';
    let token = '';
    let requests = 0;
    const request = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(gateway.url + '/api/auth' + path, {
        method,
        headers: {
          origin: gateway.url,
          cookie,
          'x-csrf-token': token,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const updated = response.headers.getSetCookie()[0];

      if (updated) {
        cookie = updated.split(';')[0];
      }

      requests++;
      const responseBody = await (response.status === 204 ? undefined : response.json());

      return { status: response.status, body: responseBody };
    };

    try {
      const anonymous = await request('GET', '/session');

      token = anonymous.body.csrfToken;
      expect(anonymous.status).toBe(200);
      expect(anonymous.body.authenticated).toBe(false);
      const denied = await request('GET', '/passkeys');

      expect(denied.status).toBe(401);
      expect(denied.body).toEqual({ error: 'authentication_required' });
      const csrfToken = token;

      token = 'synthetic_invalid_csrf';
      const forbidden = await request('POST', '/passkeys/registration/options', {});

      token = csrfToken;
      expect(forbidden.status).toBe(403);
      expect(forbidden.body).toEqual({ error: 'csrf_invalid' });
      const signup = await request('POST', '/passkeys/registration/options', {});
      const originalCookie = cookie;
      const registered = await request('POST', '/passkeys/registration/verify', {
        challengeId: signup.body.challengeId,
        response: device.register(signup.body.options.challenge, gateway.url, '127.0.0.1'),
      });

      expect(registered.status).toBe(201);
      expect(cookie).not.toBe(originalCookie);
      token = registered.body.csrfToken;
      const listed = await request('GET', '/passkeys');

      expect(listed.status).toBe(200);
      expect(listed.body.credentials).toHaveLength(1);
      const logout = await request('POST', '/logout', {});

      expect(logout.status).toBe(204);
      const session = await request('GET', '/session');

      token = session.body.csrfToken;
      expect(session.body.authenticated).toBe(false);
      const pending = await request('POST', '/passkeys/authentication/options', {});
      const login = await request('POST', '/passkeys/authentication/verify', {
        challengeId: pending.body.challengeId,
        response: device.authenticate(
          pending.body.options.challenge,
          gateway.url,
          '127.0.0.1',
          registered.body.user.id,
        ),
      });

      expect(login.status).toBe(200);
      expect(login.body.user.id).toBe(registered.body.user.id);
      const active = await probe.pool.query('SELECT count(*) FROM pg_stat_activity WHERE application_name = $1', [
        name,
      ]);

      expect(Number(active.rows[0].count)).toBeGreaterThan(0);
      const result = await gateway.stop('SIGTERM');
      const closed = await probe.pool.query('SELECT count(*) FROM pg_stat_activity WHERE application_name = $1', [
        name,
      ]);

      expect(result.code).toBe(0);
      expect(Number(closed.rows[0].count)).toBe(0);
      expect(result.events.filter((event) => event.event === 'http.request')).toHaveLength(requests);
      expect(result.events.every((event) => event.service === 'web-gateway')).toBe(true);
    } finally {
      await gateway.cleanup();
    }
  });
});
