import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'src/theme-init.ts',
  platform: 'browser',
  tsconfig: 'tsconfig.app.json',
  output: {
    dir: '../../../dist/apps/web/app-theme',
    format: 'iife',
    entryFileNames: 'theme-init.js',
    minify: true,
  },
});
