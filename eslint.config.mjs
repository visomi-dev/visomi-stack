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
          // Portable crypto is lazy in root custody and static in its lazy settings route, not a route project itself.
          checkDynamicDependenciesExceptions: ['shared-crypto'],
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
    // Roll out source-snapshot limits only after a module's compatible extraction.
    // Native Node entry points and Angular route loaders keep their required extensions.
    basePath: import.meta.dirname,
    files: [
      'apps/web/api/src/auth/auth-route-session.ts',
      'apps/web/api/src/auth/auth-router.ts',
      'apps/web/api/src/auth/device-approval-router.ts',
      'apps/web/api/src/auth/google-router.ts',
      'apps/web/api/src/auth/password-flow-router.ts',
      'apps/web/api/src/auth/reauth-router.ts',
      'apps/web/api/src/auth/security-methods.ts',
      'apps/web/api/src/auth/totp-router.ts',
      'apps/web/api/src/auth/security-router.ts',
      'apps/web/api/src/auth/passkey-router.ts',
      'apps/web/api/src/auth/passkey-ceremony.ts',
      'apps/web/api/src/auth/passkey-credentials-router.ts',
      'apps/web/api/src/auth/auth-schemas.ts',
      'apps/web/api/src/auth/auth-openapi.ts',
      'apps/web/api/src/auth/auth-recovery.ts',
      'apps/web/api/src/auth/auth-factors.ts',
      'apps/web/api/src/auth/password-account.ts',
      'apps/web/api/src/auth/password-session.ts',
      'apps/web/api/src/auth/auth-identity.ts',
      'apps/web/api/src/auth/auth-devices.ts',
      'apps/web/api/src/auth/auth-service.ts',
      'apps/web/api/src/auth/auth-middleware*.ts',
      'apps/web/api/src/auth/password-authority.spec.ts',
      'apps/web/api/src/auth/reauth-session-authority.spec.ts',
      'apps/web/api-e2e/src/support/report-sanitization.ts',
      'apps/web/api-e2e/src/support/report-sanitization.spec.ts',
      'apps/web/api-e2e/src/support/sync-fixture.ts',
      'apps/web/api-e2e/src/api/sync.spec.ts',
      'apps/web/api-e2e/src/api/sync-device-lifecycle.spec.ts',
      'apps/web/api-e2e/src/api/pzs-005-real.spec.ts',
      'apps/web/api-e2e/src/support/pzs-005-evidence.ts',
      'apps/web/api-e2e/src/support/openapi-contract*.ts',
      'apps/web/api-e2e/src/support/run-openapi-contract.ts',
      'scripts/themis-cli.ts',
      'scripts/themis-cli-context.ts',
      'scripts/themis-cli-storage.ts',
      'scripts/themis-project-migration*.ts',
      'scripts/themis-adapter*.ts',
      'libs/themis-workflow/src/lib/project-workflow*.ts',
      'libs/backend/shared/src/lib/db/schema*.ts',
      'libs/themis-workflow/src/lib/legacy-workflow*.ts',
      'apps/web/app/src/app/auth/sign-in/sign-in*.ts',
    ],
    rules: {
      'import-x/extensions': ['error', 'never', { checkTypeImports: true, ignorePackages: true }],
      curly: ['error', 'all'],
      '@stylistic/max-len': [
        'error',
        {
          code: 120,
          tabWidth: 2,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
        },
      ],
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ':matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression)[source.value=/^\\..*\\.[jt]sx?$/]',
          message: 'Omit JavaScript and TypeScript file extensions from relative module imports and exports.',
        },
        {
          selector:
            'AwaitExpression:not(VariableDeclarator > AwaitExpression.init):not(ExpressionStatement > AwaitExpression.expression)',
          message: 'Assign the awaited result to a variable before using it in another expression.',
        },
      ],
    },
  },
  {
    // These modules also execute directly with native Node TypeScript resolution.
    basePath: import.meta.dirname,
    files: [
      'scripts/themis-cli.ts',
      'apps/web/api-e2e/src/support/openapi-contract*.ts',
      'apps/web/api-e2e/src/support/run-openapi-contract.ts',
      'scripts/themis-cli-context.ts',
      'scripts/themis-cli-storage.ts',
      'scripts/themis-project-migration*.ts',
      'scripts/themis-adapter*.ts',
      'libs/themis-workflow/src/lib/project-workflow*.ts',
      'libs/themis-workflow/src/lib/legacy-workflow*.ts',
    ],
    rules: {
      'import-x/extensions': ['error', 'always', { checkTypeImports: true, ignorePackages: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AwaitExpression:not(VariableDeclarator > AwaitExpression.init):not(ExpressionStatement > AwaitExpression.expression)',
          message: 'Assign the awaited result to a variable before using it in another expression.',
        },
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
