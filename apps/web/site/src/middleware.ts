import { middleware } from 'astro:i18n';
import { defineMiddleware } from 'astro:middleware';

import { DEFAULT_LOCALE } from './content/brand';

const localizedRouting = middleware({
  prefixDefaultLocale: true,
  redirectToDefaultLocale: false,
  fallbackType: 'redirect',
});

export const onRequest = defineMiddleware((context, next) => {
  if (context.url.pathname === '/') return context.redirect(`/${DEFAULT_LOCALE}/`);
  // The repository guide is an English-only route outside the localized landing pages.
  if (context.url.pathname === '/docs/' || context.url.pathname === '/docs') return next();

  return localizedRouting(context, next);
});
