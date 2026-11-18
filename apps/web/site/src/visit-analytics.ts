import { trackVisits } from '@visomi-stack/web-shared-observability/visits';

trackVisits(window, (path) => {
  const [, locale, section] = path.split('/');

  if (locale !== 'en' && locale !== 'es') {
    return;
  }

  if (/^\/(?:en|es)(?:\/(?:architecture|docs))?\/?$/.test(path)) {
    return { locale, page: section || 'home' };
  }

  if (/^\/(?:en|es)\/ui\/?$/.test(path)) {
    return { locale, page: 'ui' };
  }

  return;
});
