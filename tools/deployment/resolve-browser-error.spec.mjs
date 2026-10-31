import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { resolveBrowserError } from './resolve-browser-error.mjs';

test('resolves an approved code fingerprint against private source maps without returning code content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'synthetic-private-source-map-'));
  const code = 'syntheticCode();';
  const id = createHash('sha256').update(code).digest('hex');

  try {
    await mkdir(join(directory, 'assets'));

    await writeFile(join(directory, 'ignored.css'), 'synthetic');

    await writeFile(join(directory, 'assets/ignored.js'), 'syntheticOtherCode();');

    await writeFile(join(directory, 'assets/main.js'), code);

    await writeFile(
      join(directory, 'assets/main.js.map'),
      JSON.stringify({
        version: 3,
        sources: ['apps/web/site/src/synthetic.ts'],
        sourcesContent: ['SYNTHETIC_PRIVATE_SOURCE_CONTENT'],
        names: [],
        mappings: 'AAAA',
      }),
    );

    const result = await resolveBrowserError(directory, id, 1, 1);

    assert.deepEqual(result, { source: 'apps/web/site/src/synthetic.ts', line: 1, column: 1 });
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_SOURCE_CONTENT'), false);
    const missing = await resolveBrowserError(directory, 'b'.repeat(64), 1, 1);

    assert.equal(missing, undefined);

    await assert.rejects(resolveBrowserError(directory, '../private', 1, 1));

    await assert.rejects(resolveBrowserError(directory, id, 0, 1));
  } finally {
    await rm(directory, { recursive: true });
  }
});
