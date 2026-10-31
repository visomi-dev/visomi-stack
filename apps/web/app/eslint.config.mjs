import { configs } from '@nx/eslint-plugin';

import baseConfig from '../../../eslint.config.mjs';

export default [
  ...configs['flat/angular'],
  ...configs['flat/angular-template'],
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
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
