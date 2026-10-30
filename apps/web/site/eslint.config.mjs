import { configs } from 'eslint-plugin-astro';

import baseConfig from '../../../eslint.config.mjs';

export default [{ ignores: ['**/.astro/**'] }, ...baseConfig, ...configs.recommended];
