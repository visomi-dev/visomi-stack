import { describe, expect, it, vi } from 'vitest';

import { loadApi, resolveApiModule } from './api-module';

function exports() {
  return { createApp: vi.fn(), authConfig: vi.fn(), createAuthentication: vi.fn() };
}

describe('compiled API contract', () => {
  it('accepts named ESM exports without invoking application factories', () => {
    const api = exports();

    expect(resolveApiModule(api)).toBe(api);
    expect(api.createApp).not.toHaveBeenCalled();
    expect(api.createAuthentication).not.toHaveBeenCalled();
  });

  it('accepts the default CommonJS namespace supplied by native ESM import', () => {
    const api = exports();

    expect(resolveApiModule({ default: api })).toBe(api);
  });

  it.each([null, {}, { createApp: true }, { createApp: () => undefined }, { default: null }])(
    'rejects incomplete compiled contracts with a controlled error',
    (namespace) => {
      expect(() => resolveApiModule(namespace)).toThrow('api_module_invalid');
    },
  );

  it.each([
    'file:///synthetic/api/main.js',
    'file:///synthetic/api/app.ts',
    'https://example.invalid/app.js',
    'file:///synthetic/api/app.js?other=1',
    'file:///synthetic/api/app.js#other',
  ])('rejects source, startup and remote imports before loading them', async (entry) => {
    await expect(loadApi(new URL(entry))).rejects.toThrow('api_entry_invalid');
  });
});
