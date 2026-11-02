import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint, Linter } from 'eslint';

const workspace = fileURLToPath(new URL('../../../../../', import.meta.url));
const filename = resolve(workspace, 'apps/web/app-e2e/auth/access.auth.spec.ts');
const paddingRule = '@stylistic/padding-line-between-statements';

async function configuredRules(cwd = workspace) {
  const resolved = await new ESLint({ cwd }).calculateConfigForFile(filename);

  if (!resolved?.rules) {
    throw new Error('eslint_configuration_required');
  }

  const config: Linter.Config = {
    files: ['**/*.ts'],
    languageOptions: resolved.languageOptions,
    plugins: resolved.plugins,
    settings: resolved.settings,
    rules: {
      'import-x/order': resolved.rules['import-x/order'],
      [paddingRule]: resolved.rules[paddingRule],
    },
  };

  return { linter: new Linter({ cwd }), config: [config] };
}

describe('workspace lint configuration', () => {
  it.each([
    { name: 'root hooks', cwd: workspace },
    { name: 'Nx project tasks', cwd: resolve(workspace, 'apps/web/app-e2e') },
  ])('keeps testing package imports in the dependency group for $name', async ({ cwd }) => {
    const source = [
      "import { expect } from '@playwright/test';",
      "import { readMailCode } from '@visomi-stack/dev-testing';",
      "import { testPostgres } from '@visomi-stack/dev-testing/postgres';",
      '',
      "import { test } from './support/fixtures';",
      '',
    ].join('\n');
    const { linter, config } = await configuredRules(cwd);
    const messages = linter.verify(source, config, { filename });

    expect(messages).toEqual([]);
  });

  it.each([
    'export type Options = { autoProvided: boolean };',
    'type Options = { autoProvided: boolean };',
    'export const options = { autoProvided: false };',
  ])('requires and fixes a blank line after %s before a decorated class', async (declaration) => {
    const service = '@Service({ autoProvided: false })\nexport class Example {}\n';
    const invalid = declaration + '\n' + service;
    const valid = declaration + '\n\n' + service;
    const { linter, config } = await configuredRules();
    const messages = linter.verify(invalid, config, { filename });

    expect(messages.map((message) => message.ruleId)).toEqual([paddingRule]);
    expect(linter.verify(valid, config, { filename })).toEqual([]);
    expect(linter.verifyAndFix(invalid, config, { filename }).output).toBe(valid);
  });
});
