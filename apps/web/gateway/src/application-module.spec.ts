import { once } from 'node:events';
import { createServer, request as nodeRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { describe, expect, it, vi } from 'vitest';

import { loadApplication, resolveApplicationModule } from './application-module';

describe('compiled Angular boundary', () => {
  it('accepts the composition factory without invoking it', () => {
    const createApp = vi.fn();
    const application = { createApp, clientDirectory: '/synthetic/app/browser' };

    expect(resolveApplicationModule(application)).toBe(application);
    expect(createApp).not.toHaveBeenCalled();
  });

  it.each([
    null,
    false,
    {},
    { createApp: 1 },
    { createApp: () => undefined },
    { createApp: () => undefined, clientDirectory: 1 },
  ])('rejects invalid composition exports', (namespace) => {
    expect(() => resolveApplicationModule(namespace)).toThrow('application_module_invalid');
  });

  it.each([
    'https://example.invalid/server/server.mjs',
    'file:///synthetic/app/src/server.ts',
    'file:///synthetic/app/server/standalone.mjs',
    'file:///synthetic/app/server/server.mjs?other=1',
    'file:///synthetic/app/server/server.mjs#other',
  ])('rejects remote, source, executable and modified entry points', async (entry) => {
    await expect(loadApplication(new URL(entry))).rejects.toThrow('application_entry_invalid');
  });

  it('imports the real compiled factory without opening a runtime or adding shutdown handlers', async () => {
    const signals = [process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')];
    const runtime = (globalThis as Record<symbol, unknown>)[Symbol.for('visomi-stack.observability.v1')];
    const application = await loadApplication(
      new URL('../../../../dist/apps/web/app/server/server.mjs', import.meta.url),
    );

    expect(typeof application.createApp).toBe('function');
    expect(application.clientDirectory).toMatch(/\/dist\/apps\/web\/app\/browser$/);
    expect([process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')]).toEqual(signals);
    expect((globalThis as Record<symbol, unknown>)[Symbol.for('visomi-stack.observability.v1')]).toBe(runtime);
  });
  it('rejects private host material without logging it and leaves process failures with the executable', async () => {
    const application = await loadApplication(
      new URL('../../../../dist/apps/web/app/server/server.mjs', import.meta.url),
    );
    const before = [process.listenerCount('unhandledRejection'), process.listenerCount('uncaughtException')];
    const parent = express();

    parent.use(application.createApp({ errorMode: 'inherited', helmetMode: 'inherited' }));
    const server = createServer(parent);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    server.listen(0, '127.0.0.1');

    await once(server, 'listening');

    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const rendered = await fetch(origin + '/app/en/');

      await rendered.text();

      expect(rendered.status).toBe(200);
      expect([process.listenerCount('unhandledRejection'), process.listenerCount('uncaughtException')]).toEqual(before);
      const rejected = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = nodeRequest(
          origin + '/app/en/?private=SYNTHETIC_PRIVATE_QUERY',
          {
            headers: { host: 'SYNTHETIC_PRIVATE_HOST.example.test' },
          },
          (response) => {
            let body = '';

            response.on('data', (chunk) => {
              body += String(chunk);
            });
            response.on('end', () => resolve({ status: response.statusCode!, body }));
          },
        );

        request.on('error', reject);
        request.end();
      });

      expect(rejected.status).toBe(400);
      expect(JSON.parse(rejected.body)).toEqual({ error: 'request_invalid' });
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();

      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
