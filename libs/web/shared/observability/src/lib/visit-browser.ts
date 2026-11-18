import type { BrowserConsent } from './consent';
import type { VisitPage } from './visits';

const transport = { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' } as const;

export function trackVisits(
  browser: Window,
  consent: BrowserConsent,
  pageForPath: (path: string) => VisitPage | undefined,
) {
  let previous: string | undefined;
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
          .fetch('/telemetry/visits', {
            ...transport,
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            keepalive: true,
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
