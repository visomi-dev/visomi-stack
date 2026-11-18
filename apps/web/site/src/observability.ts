import { createBrowserReporter } from '@visomi-stack/web-shared-observability';

// Consumers can use browserErrors.fetch for explicitly observed same-origin API requests.
export const browserErrors = createBrowserReporter('web-site', window);

if (document.documentElement.hasAttribute('data-visit-analytics')) {
  void import('./visit-analytics').catch(() => undefined);
}
