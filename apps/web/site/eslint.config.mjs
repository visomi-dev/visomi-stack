import { configs as astroConfigs } from 'eslint-plugin-astro';

import baseConfig from '../../../eslint.config.mjs';

export default [{ ignores: ['.astro/**'] }, ...baseConfig, ...astroConfigs['flat/recommended']];
