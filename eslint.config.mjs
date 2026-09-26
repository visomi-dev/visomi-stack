import { configs as nxConfigs } from '@nx/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import { importX } from 'eslint-plugin-import-x';
import * as tsParser from '@typescript-eslint/parser';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import perfectionist from 'eslint-plugin-perfectionist';
import stylistic from '@stylistic/eslint-plugin';
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
      perfectionist,
      '@stylistic': stylistic,
    },
    settings: {
      'import-x/ignore': ['^astro:'],
      // Keep workspace alias grouping independent of the lint cwd and generated resolver paths.
      'import-x/internal-regex': '^(?:shared|shared-crypto|frontend-shared|projects|themis-workflow)(?:/|$)',
    },
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@stylistic/lines-between-class-members': 'off',
      'perfectionist/sort-classes': [
        'error',
        {
          // Group members without alphabetizing or discarding initialization dependencies.
          type: 'unsorted',
          // Keep fields compact within groups and separate behavioral members.
          newlinesBetween: 1,
          newlinesInside: 0,
          newlinesBetweenOverloadSignatures: 0,
          groups: [
            'index-signature',
            'static-property',
            { group: 'static-block', newlinesInside: 1 },
            'injected-dependencies',
            'angular-bindings',
            'angular-state',
            'angular-forms',
            'angular-computed',
            'public-readonly-property',
            'protected-readonly-property',
            'private-readonly-property',
            'public-property',
            'protected-property',
            'private-property',
            'constructor',
            {
              group: ['public-get-method', 'public-set-method', 'public-method', 'public-function-property'],
              newlinesInside: 1,
            },
            {
              group: [
                'protected-get-method',
                'protected-set-method',
                'protected-method',
                'protected-function-property',
              ],
              newlinesInside: 1,
            },
            {
              group: ['private-get-method', 'private-set-method', 'private-method', 'private-function-property'],
              newlinesInside: 1,
            },
            'unknown',
            { group: 'angular-effects', newlinesInside: 1 },
          ],
          customGroups: [
            { groupName: 'static-property', selector: 'property', modifiers: ['static'] },
            {
              groupName: 'injected-dependencies',
              selector: 'property',
              elementValuePattern: '^inject(?:<[^>]*>)?\\s*\\(',
            },
            {
              groupName: 'angular-bindings',
              selector: 'property',
              elementValuePattern:
                '^(?:input|output|model|viewChild|viewChildren|contentChild|contentChildren)(?:\\.required)?(?:<[^>]*>)?\\s*\\(',
            },
            {
              groupName: 'angular-state',
              selector: 'property',
              elementValuePattern: '^(?:signal|linkedSignal)(?:<[^>]*>)?\\s*\\(',
            },
            { groupName: 'angular-forms', selector: 'property', elementValuePattern: '^form(?:<[^>]*>)?\\s*\\(' },
            {
              groupName: 'angular-computed',
              selector: 'property',
              elementValuePattern: '^computed(?:<[^>]*>)?\\s*\\(',
            },
            {
              groupName: 'angular-effects',
              selector: 'property',
              elementValuePattern: '^(?:effect|afterRenderEffect|afterNextRender|afterEveryRender)\\s*\\(',
            },
          ],
        },
      ],
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
