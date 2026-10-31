import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'src/theme-init.ts',
  platform: 'browser',
  tsconfig: 'tsconfig.json',
  output: {
    dir: '../../../dist/apps/web/site-theme',
    format: 'iife',
    entryFileNames: 'theme-init.js',
    minify: true,
  },
});
