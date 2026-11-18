import type { BrowserConsent } from './consent';
import type { VisitPage } from './visits';
import { telemetryPost } from './transport';

const transport = { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' } as const;

export function trackVisits(
  browser: Window,
  consent: BrowserConsent,
  pageForPath: (path: string) => VisitPage | undefined,
  options: { ignoreCurrent?: boolean } = {},
) {
  const initial = options.ignoreCurrent ? pageForPath(browser.location.pathname) : undefined;
  let previous = initial && initial.locale + ':' + initial.page;
  let configuration: Promise<boolean> | undefined;
  let stopped = false;

  const update = () => {
    const page = pageForPath(browser.location.pathname);
    const current = page && page.locale + ':' + page.page;

    if (current === previous) {
      return;
    }

    const permit = consent.permit();

    if (!page || !permit) {
      previous = current;

      return;
    }

    if (browser.document.visibilityState !== 'visible') {
      return;
    }

    previous = current;
    const body = JSON.stringify({ page: page.page, locale: page.locale });

    configuration ??= browser
      .fetch('/telemetry/visits/config', transport)
      .then(async (response) => {
        if (!response.ok) {
          return false;
        }

        const config = await response.json();

        return config?.enabled === true;
      })
      .catch(() => false);

    void configuration.then((enabled) => {
      if (!stopped && enabled && consent.permit() === permit) {
        return browser
          .fetch(browser.location.origin + '/telemetry/visits', {
            ...telemetryPost,
            headers: { 'content-type': 'application/json' },
            body,
          })
          .catch(() => undefined);
      }

      return;
    });
  };

  browser.document.addEventListener('astro:page-load', update);
  browser.document.addEventListener('visibilitychange', update);

  if (browser.document.readyState === 'loading') {
    browser.document.addEventListener('DOMContentLoaded', update, { once: true });
  }

  update();

  return {
    update,
    stop(): void {
      stopped = true;
      browser.document.removeEventListener('astro:page-load', update);
      browser.document.removeEventListener('visibilitychange', update);
      browser.document.removeEventListener('DOMContentLoaded', update);
    },
  };
}
