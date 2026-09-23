import { configs as nxConfigs } from '@nx/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import { importX } from 'eslint-plugin-import-x';
import * as tsParser from '@typescript-eslint/parser';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import globals from 'globals';

const importXFiles = ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts', '**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'];

export default [
  ...nxConfigs['flat/base'],
  ...nxConfigs['flat/typescript'],
  ...nxConfigs['flat/javascript'],
  eslintConfigPrettier,
  {
    ...importX.flatConfigs.recommended,
    files: importXFiles,
  },
  {
    ...importX.flatConfigs.typescript,
    files: importXFiles,
  },
  {
    ignores: ['**/dist', '**/vite.config.*.timestamp*', '**/vitest.config.*.timestamp*', '**/node_modules'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          // template.json is a public workspace build input, not another domain's implementation.
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$', '^(?:\\.\\./)+template\\.json$'],
          depConstraints: [
            {
              sourceTag: 'scope:frontend',
              onlyDependOnLibsWithTags: ['scope:frontend', 'scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:backend',
              notDependOnLibsWithTags: ['scope:frontend'],
            },
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: importXFiles,
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.builtin,
    },
    plugins: {
      unicorn: eslintPluginUnicorn,
    },
    settings: {
      'import-x/ignore': ['^astro:'],
      // Keep workspace alias grouping independent of the lint cwd and generated resolver paths.
      'import-x/internal-regex': '^(?:shared|shared-crypto|frontend-shared|projects|themis-workflow)(?:/|$)',
    },
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'import-x/order': ['error', { 'newlines-between': 'always' }],
      'import-x/no-named-as-default': 'off',
      'import-x/no-duplicates': 'error',
      'import-x/no-unresolved': 'off',
      'unicorn/filename-case': [
        'error',
        {
          case: 'kebabCase',
        },
      ],
      'unicorn/no-null': 'off',
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
        { blankLine: 'always', prev: '*', next: 'return' },
      ],
    },
  },
  {
    files: ['apps/web/site/**/*.ts'],
    rules: {
      'import-x/no-unresolved': [
        'error',
        {
          ignore: ['^astro:'],
        },
      ],
    },
  },
  {
    files: ['libs/frontend/shared/src/**/*.ts', 'libs/shared/crypto/src/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', '@angular/*', 'astro', 'astro/*', '@astrojs/*'],
              message: 'Shared browser and portable code must use framework-agnostic, browser-compatible APIs.',
            },
          ],
        },
      ],
    },
  },
];
