import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { browserAssets } from './assets';

describe('browser build asset allowlist', () => {
  it('fingerprints JavaScript, bounds source positions, preserves localized aliases, and ignores symlinks and maps', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synthetic-browser-assets-'));

    try {
      await mkdir(join(directory, 'es'));

      await writeFile(join(directory, 'main.js'), 'synthetic\ncode');

      await writeFile(join(directory, 'es/main.mjs'), 'synthetic\ncode');

      await writeFile(join(directory, 'main.js.map'), 'synthetic_private_source_map');

      await writeFile(join(directory, 'style.css'), 'synthetic');

      const assets = await browserAssets(directory, '/app');
      const id = createHash('sha256').update('synthetic\ncode').digest('hex');

      expect(assets.size).toBe(1);
      expect(assets.get(id)?.paths.sort()).toEqual(['/app/es/main.mjs', '/app/main.js']);
      expect(assets.get(id)?.lines).toEqual([9, 4]);
      const siteAssets = await browserAssets(directory);

      expect(siteAssets.get(id)?.paths).toContain('/main.js');
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
