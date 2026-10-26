import playwright from 'eslint-plugin-playwright';

import baseConfig from '../../../eslint.config.mjs';

export default [{ ...playwright.configs['flat/recommended'], files: ['**/e2e/**/*.ts'] }, ...baseConfig];
