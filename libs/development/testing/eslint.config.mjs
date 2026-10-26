import baseConfig from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    settings: {
      'import-x/internal-regex': '^@visomi-stack/',
    },
  },
  {
    files: ['src/lib/playwright/fixtures/**/*.ts'],
    rules: {
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
    },
  },
];
