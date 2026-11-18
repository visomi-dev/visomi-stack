import type { VisitPage } from './visits';

const transport = { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' } as const;

export function trackVisits(browser: Window, pageForPath: (path: string) => VisitPage | undefined): void {
  let previous: string | undefined;
  let configuration: Promise<boolean> | undefined;

  const update = () => {
    const page = pageForPath(browser.location.pathname);
    const current = page && page.locale + ':' + page.page;

    if (current === previous) {
      return;
    }

    previous = current;

    if (!page || browser.navigator.doNotTrack === '1' || browser.document.visibilityState !== 'visible') {
      // A hidden document can be the initial prerender rather than a visited page.
      previous = undefined;

      return;
    }

    const body = JSON.stringify({ page: page.page, locale: page.locale });

    configuration ??= browser
      .fetch('/telemetry/visits/config', transport)
      .then(async (response) => {
        if (!response.ok) {
          return false;
        }

        const configuration = await response.json();

        return configuration?.enabled === true;
      })
      .catch(() => false);

    void configuration.then((enabled) => {
      if (enabled) {
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
  } else {
    update();
  }
}
