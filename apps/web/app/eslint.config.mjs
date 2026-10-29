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
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['src/app/ui/button.ts'],
    rules: {
      // The native button uses the standalone `ui` marker rather than an app-prefixed name.
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: [],
          style: 'camelCase',
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
