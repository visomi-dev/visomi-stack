export default {
  // Import fixers can emit extra whitespace; stage the formatter's final bytes.
  '*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}': ['prettier --write', 'eslint --fix --max-warnings=0', 'prettier --write'],
  '*.{html,astro}': ['prettier --write', 'eslint --fix --max-warnings=0', 'prettier --write'],
  '*.{json,jsonc,md,mdx,yaml,yml,css,scss,less}': 'prettier --write',
};
