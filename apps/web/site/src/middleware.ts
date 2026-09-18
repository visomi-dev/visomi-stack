import { middleware } from 'astro:i18n';
import { defineMiddleware } from 'astro:middleware';

const localizedRouting = middleware({ prefixDefaultLocale: true, redirectToDefaultLocale: false });

export const onRequest = defineMiddleware((context, next) => {
  // The repository guide is an English-only route outside the localized landing pages.
  if (context.url.pathname === '/docs/' || context.url.pathname === '/docs') return next();

  return localizedRouting(context, next);
});
