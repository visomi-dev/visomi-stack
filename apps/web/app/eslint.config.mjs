import { configs } from '@nx/eslint-plugin';

import baseConfig, { moduleBoundaryOptions } from '../../../eslint.config.mjs';

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
                  onlyDependOnLibsWithTags: ['scope:web-frontend', 'scope:web-shared', 'scope:web-backend'],
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
    files: ['**/ui/forms/field.ts', '**/ui/layout/app-shell.ts'],
    rules: {
      // Component template APIs use kebab-case while TypeScript members remain camelCase.
      '@angular-eslint/no-input-rename': [
        'error',
        { allowedNames: ['control-id', 'manual-error', 'content-id', 'skip-label'] },
      ],
    },
  },
  {
    files: ['**/*.html'],
    // Override or add rules here
    rules: {},
  },
];
