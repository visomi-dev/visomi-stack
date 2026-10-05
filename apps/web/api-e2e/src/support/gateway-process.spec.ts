import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { requireFreeGatewayPort, stopGateway, waitForGateway } from './gateway-process';
import { gatewayStorageEnvironment } from './gateway-environment';
import { createVerifiedPasswordAccount } from './password-fixture';
import { requireObservedSmokeResults } from './smoke-assertions';

test('HTTP smoke failures fail the verification target instead of only entering an evidence report', () => {
  requireObservedSmokeResults([{ name: 'success', observed: true }]);
  assert.throws(
    () => requireObservedSmokeResults([{ name: 'failure', observed: false }]),
    /failed 1 required assertions/,
  );
});

test('password fixtures retain the flow cookie, CSRF origin and current verification contract', async (context) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  context.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (calls.length === 1)
      return Response.json(
        { data: { flowId: 'fixture-flow' } },
        {
          status: 202,
          headers: { 'set-cookie': 'sid=pending; HttpOnly; Path=/' },
        },
      );
    if (calls.length === 2) return Response.json({ pin: '123456' });

    return Response.json({ data: {} }, { headers: { 'set-cookie': 'sid=verified; HttpOnly; Path=/' } });
  });
  const origin = 'http://127.0.0.1:18083';
  const cookie = await createVerifiedPasswordAccount(
    `${origin}/api`,
    origin,
    'fixture@example.test',
    'synthetic-password',
  );

  assert.equal(cookie, 'sid=verified');
  assert.ok(calls[1].url.endsWith('purpose=password_signup'));
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), { flowId: 'fixture-flow', code: '123456' });
  assert.equal(new Headers(calls[2].init?.headers).get('cookie'), 'sid=pending');
  assert.equal(new Headers(calls[2].init?.headers).get('origin'), origin);
});

test('password fixtures reject a successful response lacking its bound flow cookie', async (context) => {
  const fetch = context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ data: { flowId: 'fixture-flow' } }),
  );

  await assert.rejects(
    createVerifiedPasswordAccount(
      'http://127.0.0.1/api',
      'http://127.0.0.1',
      'fixture@example.test',
      'synthetic-password',
    ),
    /bound verification flow/,
  );
  assert.equal(fetch.mock.callCount(), 1);
});

test('fast API suites ignore inherited durable development settings unless explicitly selected', () => {
  assert.deepEqual(gatewayStorageEnvironment({ DATABASE_DRIVER: 'pg', OPAQUE_SYNC_STORAGE: 'durable' }), {
    DATABASE_DRIVER: 'memory',
    OPAQUE_SYNC_STORAGE: 'memory',
  });
  assert.deepEqual(
    gatewayStorageEnvironment({
      API_E2E_STORAGE_MODE: 'durable',
      DATABASE_DRIVER: 'pg',
      OPAQUE_SYNC_STORAGE: 'durable',
    }),
    {
      DATABASE_DRIVER: 'pg',
      OPAQUE_SYNC_STORAGE: 'durable',
    },
  );
  for (const mode of ['durable', 'invalid']) {
    assert.throws(() => gatewayStorageEnvironment({ API_E2E_STORAGE_MODE: mode }), /requires an explicit/);
  }
});

test('API fixture refuses to use a port owned by an unrelated server', async () => {
  const server = createServer((_request, response) => response.end('unrelated'));

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;

  try {
    await assert.rejects(requireFreeGatewayPort('127.0.0.1', port), /already occupied/);
  } finally {
    server.close();
    await once(server, 'close');
  }
  await requireFreeGatewayPort('127.0.0.1', port);
});

test('API readiness stops immediately when the child exits rather than waiting for a port deadline', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(23)'], { detached: process.platform !== 'win32' });

  try {
    await assert.rejects(waitForGateway(child, 'http://127.0.0.1:1/healthz', 5000), /exited before readiness/);
    assert.equal(child.exitCode, 23);
    assert.equal(child.listenerCount('exit'), 0);
    assert.equal(child.listenerCount('error'), 0);
    await stopGateway(child);
  } finally {
    child.kill('SIGKILL');
  }
});

test('API readiness ignores another healthy server after the owned child already exited', async () => {
  const server = createServer((_request, response) => response.end('healthy'));

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { detached: process.platform !== 'win32' });

  await once(child, 'exit');
  try {
    await assert.rejects(waitForGateway(child, `http://127.0.0.1:${port}/healthz`, 5000), /exited before readiness/);
    await stopGateway(child);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('API readiness times out and owned-child cleanup terminates a live fixture', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: process.platform !== 'win32',
  });

  try {
    await assert.rejects(waitForGateway(child, 'http://127.0.0.1:1/healthz', 100), /deadline expired/);
    await stopGateway(child);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  } finally {
    child.kill('SIGKILL');
  }
});

test(
  'API cleanup waits for SIGKILL escalation to terminate a resistant owned child',
  {
    skip: process.platform === 'win32',
    timeout: 8000,
  },
  async () => {
    const child = spawn(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"],
      {
        detached: true,
      },
    );

    try {
      await once(child.stdout!, 'data');
      await stopGateway(child);
      assert.equal(child.signalCode, 'SIGKILL');
    } finally {
      child.kill('SIGKILL');
    }
  },
);
