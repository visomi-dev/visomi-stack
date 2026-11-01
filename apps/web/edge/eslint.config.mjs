import baseConfig from '../../../eslint.config.mjs';

export default [...baseConfig, { ignores: ['.cloudflare/**', '.wrangler/**'] }];
