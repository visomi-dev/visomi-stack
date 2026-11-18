import { configs } from '@nx/eslint-plugin';

import baseConfig, { moduleBoundaryOptions, statementPadding } from '../../../eslint.config.mjs';

export default [
  ...configs['flat/angular'],
  ...configs['flat/angular-template'],
  ...baseConfig,
  {
    files: ['src/server.ts', 'src/standalone.ts'],
    settings: { 'import-x/internal-regex': '^@visomi-stack/(?:web-backend-shared|web-shared-observability)(?:/|$)' },
    rules: {
      // The Node executable owns server telemetry; browser application code cannot import backend modules.
      '@nx/enforce-module-boundaries': [
        'error',
        {
          ...moduleBoundaryOptions,
          depConstraints: moduleBoundaryOptions.depConstraints.map((constraint) =>
            constraint.sourceTag === 'scope:web-frontend'
              ? {
                  ...constraint,
                  onlyDependOnLibsWithTags: [
                    'scope:web-frontend',
                    'scope:web-shared',
                    'scope:web-backend',
                    'scope:shared',
                  ],
                }
              : constraint,
          ),
        },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@stylistic/padding-line-between-statements': [
        ...statementPadding,
        {
          blankLine: 'always',
          prev: 'expression',
          next: { selector: 'VariableDeclaration:has(VariableDeclarator > AwaitExpression.init)' },
        },
        { blankLine: 'always', prev: 'multiline-expression', next: 'expression' },
      ],
      '@angular-eslint/prefer-service-decorator': 'error',
      '@angular-eslint/prefer-inject': 'error',
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: ['element', 'attribute'],
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: [
      '**/ui/forms/field.ts',
      '**/ui/forms/pin-input.ts',
      '**/ui/layout/app-shell.ts',
      '**/vault/vault-panel.ts',
      '**/vault/vault-unlock.ts',
    ],
    rules: {
      // Component template APIs use kebab-case while TypeScript members remain camelCase.
      '@angular-eslint/no-input-rename': [
        'error',
        {
          allowedNames: [
            'control-id',
            'manual-error',
            'accept-formatted-paste',
            'content-id',
            'skip-label',
            'rp-id',
            'allow-initialize',
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    // Override or add rules here
    rules: {},
  },
];
