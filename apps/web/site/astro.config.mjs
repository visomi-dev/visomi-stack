import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://stack.visomi.dev',
  adapter: node({ mode: 'middleware' }),
  logger: { entrypoint: new URL('./src/logger.js', import.meta.url) },
  output: 'server',
  outDir: '../../../dist/apps/web/site',
  trailingSlash: 'always',
  build: { inlineStylesheets: 'never' },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: true },
  },
  vite: {
    // The gateway permits only external scripts, including small processed TypeScript entries.
    build: { assetsInlineLimit: 0 },
    plugins: [tailwindcss()],
    css: { postcss: { plugins: [] } },
  },
});
