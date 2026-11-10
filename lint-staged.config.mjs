export default {
  '*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}': ['prettier --write', 'eslint --fix --max-warnings=0'],
  '*.{html,astro}': ['prettier --write', 'eslint --fix --max-warnings=0'],
  '*.{json,jsonc,md,mdx,yaml,yml,css,scss,less}': 'prettier --write',
};
