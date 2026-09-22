import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

import template from '../../../template.json' with { type: 'json' };

const base = process.env.BASE_URL ?? '/';

const site = process.env.SITE_URL || template.project.publicOrigin || template.local.origin;

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
    defaultLocale: template.project.defaultLocale,
    locales: ['en', 'es'],
    routing: 'manual',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
