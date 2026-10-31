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
});
