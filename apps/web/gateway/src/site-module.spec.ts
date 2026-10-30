import { describe, expect, it, vi } from 'vitest';

import { loadSite, resolveSiteHandler } from './site-module';

describe('compiled Astro boundary', () => {
  it('accepts the named middleware export without invoking it', () => {
    const handler = vi.fn();

    expect(resolveSiteHandler({ handler })).toBe(handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([null, false, {}, { handler: 1 }])('rejects invalid middleware exports', (namespace) => {
    expect(() => resolveSiteHandler(namespace)).toThrow('site_module_invalid');
  });

  it.each([
    'https://example.invalid/server/entry.mjs',
    'file:///synthetic/site/src/index.ts',
    'file:///synthetic/site/server/entry.mjs?other=1',
    'file:///synthetic/site/server/entry.mjs#other',
  ])('rejects remote, source and modified entry points before importing', async (entry) => {
    await expect(loadSite(new URL(entry))).rejects.toThrow('site_entry_invalid');
  });
});
