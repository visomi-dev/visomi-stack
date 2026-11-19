import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint, Linter } from 'eslint';

const root = fileURLToPath(new URL('../../', import.meta.url));

async function messages(directory, path, source, ruleId) {
  const eslint = new ESLint({ cwd: resolve(root, directory) });
  const config = await eslint.calculateConfigForFile(resolve(root, path));
  const linter = new Linter();

  return linter.verify(source, [
    {
      languageOptions: config.languageOptions,
      plugins: config.plugins,
      settings: config.settings,
      rules: { [ruleId]: config.rules[ruleId] },
    },
  ]);
}

for (const mode of ['root', 'project']) {
  test(`${mode}: backend database imports keep the same order in hooks and project lint`, () => {
    // Resolver caches and process cwd must match separate hook/Nx invocations.
    const result = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { readFileSync } from 'node:fs';
      import { ESLint } from 'eslint';
      const { source, filePath } = JSON.parse(readFileSync(0, 'utf8'));
      const [result] = await new ESLint().lintText(source, { filePath });
      process.stdout.write(JSON.stringify(result.messages.filter(({ ruleId }) => ruleId === 'import-x/order')));
    `,
      ],
      {
        cwd: resolve(root, mode === 'root' ? '.' : 'libs/backend/db'),
        encoding: 'utf8',
        input: JSON.stringify({
          source:
            "import type { Pool } from 'pg';\nimport { InjectionToken } from '@visomi-stack/backend-shared';\n\nimport type { Database } from './database';\n\nexport const DATABASE = new InjectionToken<Database>('database');\nexport const DATABASE_POOL = new InjectionToken<Pool>('database pool');\n",
          filePath: resolve(root, 'libs/backend/db/src/lib/tokens.ts'),
        }),
      },
    );

    assert.deepEqual(JSON.parse(result), []);
  });

  test(`${mode}: shared contracts reject runtime adapters and browser adapters reject server imports`, async () => {
    for (const [project, file, imports] of [
      ['libs/shared/db', 'src/lib/policy.ts', ['dexie', 'node:crypto', '@angular/core', 'express', 'drizzle-orm']],
      ['libs/web/frontend/db', 'src/lib/crypto/cipher.ts', ['node:crypto', '@angular/core', 'express', 'drizzle-orm']],
      ['apps/web/api', 'src/db/records.ts', ['dexie']],
      ['libs/backend/db', 'src/lib/schema-vault.ts', ['dexie']],
      ['libs/backend/shared', 'src/lib/injection.ts', ['dexie']],
    ]) {
      const cwd = mode === 'root' ? '.' : project;

      for (const dependency of imports) {
        const result = await messages(
          cwd,
          `${project}/${file}`,
          `import { value } from '${dependency}';`,
          'no-restricted-imports',
        );

        assert.equal(result.length, 1, `${mode}: ${project} must reject ${dependency}`);
        assert.equal(result[0].ruleId, 'no-restricted-imports');
      }
    }
  });

  test(`${mode}: components delegate transport to services`, async () => {
    for (const transport of ['HttpClient', 'DatabaseHttp', 'AuthHttp']) {
      const result = await messages(
        mode === 'root' ? '.' : 'apps/web/app',
        'apps/web/app/src/app/db/example/example.ts',
        `@Component({}) class Example { private readonly transport = inject(${transport}); }`,
        'no-restricted-syntax',
      );

      assert.equal(result.length, 1);
      assert.equal(result[0].message, 'Components invoke domain services; network transport belongs in services.');
    }

    const result = await messages(
      mode === 'root' ? '.' : 'apps/web/app',
      'apps/web/app/src/app/db/example/example.ts',
      '@Component({}) class Example { readonly workspace = inject(ExampleWorkspace); }',
      'no-restricted-syntax',
    );

    assert.deepEqual(result, []);
  });

  test(`${mode}: browser integration fixture permits erased types but forbids executing the adapter in Node`, async () => {
    const path = 'apps/web/api/tests/integration/support/browser-server.ts';
    const cwd = mode === 'root' ? '.' : 'apps/web/api';
    const valid = await messages(
      cwd,
      path,
      "import type { IndexedDbVaultStorage } from '@visomi-stack/web-frontend-db/storage';",
      'no-restricted-imports',
    );
    const invalid = await messages(
      cwd,
      path,
      "import { IndexedDbVaultStorage } from '@visomi-stack/web-frontend-db/storage';",
      'no-restricted-imports',
    );

    assert.deepEqual(valid, []);
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0].ruleId, 'no-restricted-imports');
  });
}
