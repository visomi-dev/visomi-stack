export default {
  '*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}': ['prettier --write', 'eslint --max-warnings=0'],
  '*.{json,jsonc,md,mdx,yaml,yml,html,css,scss,less}': 'prettier --write',
};
