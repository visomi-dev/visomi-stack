import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

const base = process.env.BASE_URL ?? '/';

const site = process.env.SITE_URL ?? 'https://stack.visomi.dev';

export default defineConfig({
  adapter: node({
    mode: 'middleware',
  }),
  base,
  output: 'server',
  outDir: '../../../dist/apps/web/site',
  publicDir: './public',
  srcDir: './src',
  site,
  trailingSlash: 'always',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    routing: {
      prefixDefaultLocale: true,
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
