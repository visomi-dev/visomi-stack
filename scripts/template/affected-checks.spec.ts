import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { companion, quote, selectCheck } from './checks/selection.ts';
import type { Project } from './checks/selection.ts';

const app: Project = {
  name: 'app',
  root: 'apps/web/app',
  targets: {
    lint: { executor: '@nx/eslint:lint' },
    'vite:test': { executor: 'nx:run-commands', options: { command: 'vitest' } },
  },
};
const browser: Project = {
  name: 'app-e2e',
  root: 'apps/web/app-e2e',
  targets: { e2e: { executor: '@nx/playwright:playwright' } },
};
const library: Project = {
  name: 'shared',
  root: 'libs/backend/shared',
  targets: { test: { options: { command: 'jest' } } },
};

test('uses exact changed paths for lint instead of re-linting every consumer', () => {
  const files = ['apps/web/app/src/app/account/account.ts'];

  assert.deepEqual(selectCheck(app, 'lint', files)?.args, [`--lintFilePatterns=${files[0]}`]);
  assert.equal(selectCheck(app, 'lint', ['libs/backend/shared/src/lib/http.ts']), null);
});

test('lint rule changes check affected consumers, including existing template-local rules', () => {
  for (const file of [
    'eslint.config.mjs',
    'tools/eslint-rules/layout.mjs',
    'tools/eslint/layout.mjs',
    'apps/web/app/tsconfig.app.json',
  ]) {
    assert.deepEqual(selectCheck(app, 'lint', [file])?.args, []);
  }
});

test('bundled native Node tests select changed specs but retain full implementation coverage', () => {
  const native: Project = {
    name: 'template',
    root: 'scripts/template',
    targets: {
      test: {
        options: { command: 'pnpm exec esbuild scripts/template/*.spec.ts && node --test dist/template/tests/*.cjs' },
      },
    },
  };
  const file = 'scripts/template/affected-checks.spec.ts';
  const selected = selectCheck(native, 'test', [file]);

  assert.equal(selected?.reason, 'changed native Node test files');
  assert.ok(selected?.args[0].includes('affected-checks.spec.cjs'));
  assert.ok(!selected?.args[0].includes('*.cjs'));
  assert.deepEqual(selectCheck(native, 'test', [file, 'scripts/template/checks/selection.ts'])?.args, []);
});

test('filters the owning library but keeps complete suites in Nx-selected consumers', () => {
  const files = ['libs/backend/shared/src/lib/http.ts'];

  assert.deepEqual(selectCheck(library, 'test', files)?.args, [
    `--args=--findRelatedTests ${quote(resolve(files[0]))} --passWithNoTests --runInBand`,
  ]);
  assert.deepEqual(selectCheck(app, 'vite:test', files)?.args, ['--run']);
  assert.deepEqual(selectCheck(browser, 'e2e', files)?.args, []);
});

test('runs one-shot complete unit suites for config changes and deleted sources', () => {
  assert.deepEqual(selectCheck(app, 'vite:test', ['apps/web/app/vite.config.mts'])?.args, ['--run']);
  assert.deepEqual(selectCheck(library, 'test', ['libs/backend/shared/src/lib/http.ts'], ['deleted.ts'])?.args, []);
  const removed = 'apps/web/app/src/app/removed.ts';

  assert.equal(selectCheck(app, 'lint', [removed], [removed]), null);
  assert.deepEqual(selectCheck(app, 'lint', ['eslint.config.mjs'], ['eslint.config.mjs'])?.args, []);
});

test('selects changed browser specs and retains the configured browser matrix', () => {
  const file = 'apps/web/app-e2e/src/app/notifications.spec.ts';

  assert.deepEqual(selectCheck(browser, 'e2e', [file])?.args, [`--testFiles=${resolve(file)}`]);
});

test('selects fixture consumers but never filters runtime changes with only-changed', () => {
  assert.deepEqual(selectCheck(browser, 'e2e', ['apps/web/app-e2e/src/support/auth.ts'])?.args, [
    '--onlyChanged',
    '--passWithNoTests',
  ]);
  assert.deepEqual(selectCheck(browser, 'e2e', ['apps/web/app/src/app/account/account.ts'])?.args, []);
  assert.deepEqual(selectCheck(browser, 'e2e', ['apps/web/app-e2e/playwright.config.ts'])?.args, []);
});

test('maps Angular templates and styles to their owner for related unit tests', () => {
  for (const extension of ['html', 'css', 'scss']) {
    assert.equal(
      companion(`apps/web/app/src/app/shared/layout/layout.${extension}`),
      'apps/web/app/src/app/shared/layout/layout.ts',
    );
  }
  assert.match(
    selectCheck(app, 'vite:test', [
      'apps/web/app/src/app/shared/layout/layout.html',
      'apps/web/app/src/app/shared/layout/layout.ts',
    ])?.args[0] ?? '',
    /^--args=related /,
  );
  assert.deepEqual(selectCheck(app, 'vite:test', ['apps/web/app/src/styles.css'])?.args, ['--run']);
});

test('unmapped assets and mixed documentation cannot silently discard unit coverage', () => {
  assert.deepEqual(selectCheck(app, 'vite:test', ['docs/guide.md', 'apps/web/app/src/app/account/account.ts'])?.args, [
    '--run',
  ]);
  assert.deepEqual(selectCheck(app, 'vite:test', ['apps/web/app/public/icon.svg'])?.args, ['--run']);
});

test('maps visual and Jest snapshots to their owning spec', () => {
  assert.equal(
    companion('apps/web/app-e2e/src/__snapshots__/chromium/app/notifications.spec.ts/mobile.png'),
    'apps/web/app-e2e/src/app/notifications.spec.ts',
  );
  assert.equal(
    companion('libs/shared/crypto/src/__snapshots__/vault.spec.ts.snap'),
    'libs/shared/crypto/src/vault.spec.ts',
  );
});

test('skips missing targets and preserves runners without a related-file mode', () => {
  assert.equal(selectCheck(app, 'test', ['source.ts']), null);
  const native: Project = {
    name: 'native',
    root: 'scripts',
    targets: { test: { options: { command: 'node --test scripts/*.spec.ts' } } },
  };

  assert.deepEqual(selectCheck(native, 'test', ['scripts/tool.ts'])?.args, []);
});

test('quotes spaces and apostrophes without shell expansion', () => {
  assert.equal(quote("a folder/user's file.ts"), "'a folder/user'\\''s file.ts'");
});
