import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  adapter: node({ mode: 'middleware' }),
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
    plugins: [tailwindcss()],
    css: { postcss: { plugins: [] } },
  },
});
