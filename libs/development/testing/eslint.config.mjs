import baseConfig from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    settings: {
      'import-x/internal-regex': '^@visomi-stack/',
    },
  },
];
