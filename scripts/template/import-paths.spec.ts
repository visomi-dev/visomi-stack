import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { ESLint } from 'eslint';

const root = process.cwd();

test('workspace-scoped strict rules remain active from inferred project working directories', async () => {
  for (const [project, source] of [
    ['apps/web/api', 'src/auth/auth-middleware.ts'],
    ['apps/web/api-e2e', 'src/support/run-openapi-contract.ts'],
    ['libs/backend/shared', 'src/lib/db/schema.ts'],
  ]) {
    const fromRoot = await new ESLint({ cwd: root }).calculateConfigForFile(resolve(root, project, source));
    const fromProject = await new ESLint({ cwd: resolve(root, project) }).calculateConfigForFile(source);

    for (const rule of ['curly', 'max-lines', '@stylistic/max-len', 'no-restricted-syntax', 'import-x/extensions']) {
      assert.equal(fromProject.rules[rule][0], 2, `${project}: ${rule} must be enforced`);
      assert.deepEqual(fromProject.rules[rule], fromRoot.rules[rule], `${project}: ${rule} must not depend on cwd`);
    }
  }
});

test('source extension restrictions do not rely on successful import resolution', async () => {
  const config = await new ESLint({ cwd: root }).calculateConfigForFile('apps/web/api/src/auth/auth-middleware.ts');
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: config.languageOptions,
        plugins: config.plugins,
        settings: config.settings,
        rules: { 'no-restricted-syntax': config.rules['no-restricted-syntax'] },
      },
    ],
  });

  for (const extension of ['ts', 'tsx', 'js', 'jsx']) {
    for (const source of [
      `import value from './missing.${extension}';`,
      `import type { Value } from '../missing.${extension}';`,
      `export { value } from './missing.${extension}';`,
      `export * from './missing.${extension}';`,
      `const load = () => import('./missing.${extension}');`,
    ]) {
      const [result] = await eslint.lintText(source, { filePath: 'import-paths.ts' });

      assert.ok(
        result.messages.some((message) => message.ruleId === 'no-restricted-syntax'),
        source,
      );
    }
  }
});

test('native Node entry points retain required TypeScript extensions without weakening awaited-value checks', async () => {
  const config = await new ESLint({ cwd: root }).calculateConfigForFile(
    'apps/web/api-e2e/src/support/run-openapi-contract.ts',
  );
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: config.languageOptions,
        plugins: config.plugins,
        settings: config.settings,
        rules: { 'no-restricted-syntax': config.rules['no-restricted-syntax'] },
      },
    ],
  });
  const [allowed] = await eslint.lintText("import { value } from './missing.ts';", { filePath: 'native-entry.ts' });
  const [denied] = await eslint.lintText('const value = transform(await load());', { filePath: 'native-entry.ts' });

  assert.deepEqual(allowed.messages, []);
  assert.ok(denied.messages.some((message) => message.ruleId === 'no-restricted-syntax'));
});
