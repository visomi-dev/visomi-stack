import type { Page, Response } from '@playwright/test';

import { expect, signup, test } from './support/fixtures';

import { browserConsentKey, browserPrivacyCopy } from '@visomi-stack/web-shared-observability';

const marker = 'SYNTHETIC_PRIVATE_CONSENT_CONTENT';

function requests(page: Page) {
  const observed: { path: string; payload: unknown }[] = [];

  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;

    if (path.startsWith('/telemetry/')) {
      observed.push({ path, payload: request.postDataJSON() });
    }
  });

  return observed;
}

function privacy(page: Page, locale: 'en' | 'es' = 'en') {
  const copy = browserPrivacyCopy[locale];
  const opener = page.getByRole('button', { name: new RegExp(copy.title) });
  const dialog = page.getByRole('dialog', { name: copy.title });

  return {
    copy,
    opener,
    dialog,
    accept: dialog.getByRole('button', { name: copy.accept }),
    reject: dialog.getByRole('button', { name: copy.reject }),
  };
}

function endpoint(page: Page, path: string): Promise<Response> {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.request().method() === 'POST',
  );
}

async function throwError(page: Page, kind: 'RangeError' | 'TypeError' | 'SyntaxError') {
  // Schedule a real uncaught exception in the document, with wholly synthetic data.
  await page.evaluate(
    ({ kind, marker }) => {
      setTimeout(() => {
        throw new window[kind](marker);
      });
    },
    { kind, marker },
  );
}

test('shares consent across Astro and the guarded Angular dashboard, and sends only one selected exception', async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 1366, height: 900 });

  await page.emulateMedia({ colorScheme: 'light' });

  const observed = requests(page);

  await page.goto('/app/en/home');

  await expect(page).toHaveURL(/\/auth\/sign-in/);

  await signup(page);

  const app = privacy(page);

  await expect(app.opener).toBeEnabled();

  expect(observed).toEqual([]);

  await page.goto('/en/');

  const site = privacy(page);

  await expect(site.opener).toHaveAccessibleName(site.copy.title);

  const expectedFailures = await page.evaluate(async () => {
    await Promise.reject(new TypeError('synthetic handled error')).catch(() => undefined);

    const response = await fetch('/api/synthetic-consent-404');

    return response.status;
  });

  expect(expectedFailures).toBe(404);

  await expect(site.opener).toHaveAccessibleName(site.copy.title);

  expect(observed).toEqual([]);

  await throwError(page, 'TypeError');

  await throwError(page, 'RangeError');

  await expect(site.opener).toHaveAccessibleName(new RegExp(site.copy.pending));

  await site.opener.focus();

  await site.opener.press('Enter');

  await expect(site.dialog).toBeVisible();

  await expect(site.dialog.getByText(site.copy.off)).toBeVisible();

  const styles = (control: HTMLElement) => {
    const style = getComputedStyle(control);
    const rect = control.getBoundingClientRect();

    return [style.backgroundColor, style.color, style.borderColor, style.fontSize, rect.width, rect.height];
  };

  const acceptStyles = await site.accept.evaluate(styles);
  const rejectStyles = await site.reject.evaluate(styles);

  expect(acceptStyles).toEqual(rejectStyles);

  await site.dialog.getByRole('link', { name: site.copy.purpose }).press('Enter');

  await expect(site.dialog.getByRole('heading', { name: site.copy.purpose })).toBeFocused();

  const previews = site.dialog.getByRole('listitem');

  await expect(previews).toHaveCount(2);

  await expect(site.dialog).not.toContainText(marker);

  expect(observed).toEqual([]);

  await page.screenshot({ path: info.outputPath('website-desktop-light-en.png'), animations: 'disabled' });

  await info.attach('website-desktop-light-en', { path: info.outputPath('website-desktop-light-en.png') });

  const report = endpoint(page, '/telemetry/errors');

  await previews.filter({ hasText: 'RangeError' }).getByRole('button', { name: site.copy.send }).click();

  const sent = await report;

  expect(sent.status()).toBe(202);
  expect(sent.request().postDataJSON()).toEqual({
    application: 'web-site',
    code: 'unhandled_exception',
    kind: 'RangeError',
    screen: 'home',
  });

  await expect(previews).toHaveCount(1);

  await expect(site.dialog.getByText(site.copy.off)).toBeVisible();

  await expect(site.dialog.getByText(site.copy.sent)).toBeVisible();

  const decision = await page.evaluate((key) => localStorage.getItem(key), browserConsentKey);

  expect(decision).toBeNull();

  await previews.getByRole('button', { name: site.copy.discard }).click();

  await expect(previews).toHaveCount(0);

  await expect(site.opener).toHaveAccessibleName(site.copy.title);

  await throwError(page, 'SyntaxError');

  await expect(previews).toHaveCount(1);

  await site.reject.click();

  await expect(site.dialog.getByText(site.copy.off)).toBeVisible();

  await site.accept.click();

  await expect(site.dialog.getByText(site.copy.on)).toBeVisible();

  await expect(previews).toHaveCount(0);

  expect(observed.map(({ path }) => path)).toEqual(['/telemetry/config', '/telemetry/errors']);

  const automatic = endpoint(page, '/telemetry/errors');

  await throwError(page, 'TypeError');

  const automaticResponse = await automatic;

  expect(automaticResponse.status()).toBe(202);

  await page.keyboard.press('Escape');

  await expect(site.opener).toBeFocused();

  const docs = endpoint(page, '/telemetry/visits');

  await page.goto('/en/docs/?private=' + marker + '#' + marker);

  const docsResponse = await docs;

  expect(docsResponse.status()).toBe(204);

  const dashboard = endpoint(page, '/telemetry/visits');

  await page.goto('/app/en/home?private=' + marker + '#' + marker);

  const visit = await dashboard;

  expect(visit.status()).toBe(204);
  expect(visit.request().postDataJSON()).toEqual({ page: 'app-dashboard', locale: 'en' });
  const visitHeaders = await visit.request().allHeaders();

  expect(visitHeaders).not.toHaveProperty('cookie');
  expect(visitHeaders).not.toHaveProperty('referer');

  await app.opener.click();

  await expect(app.dialog.getByText(app.copy.on)).toBeVisible();

  await app.reject.click();

  await expect(app.dialog.getByText(app.copy.off)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });

  await page.emulateMedia({ colorScheme: 'dark' });

  const beforeReload = observed.length;

  await page.goto('/app/es/home');

  const localized = privacy(page, 'es');

  await expect(localized.opener).toHaveAccessibleName(localized.copy.title);

  await throwError(page, 'RangeError');

  await expect(localized.opener).toHaveAccessibleName(new RegExp(localized.copy.pending));

  await localized.opener.click();

  await expect(localized.dialog.getByText(localized.copy.off)).toBeVisible();

  await expect(localized.dialog.getByRole('link', { name: localized.copy.purpose })).toBeVisible();

  const localizedAcceptStyles = await localized.accept.evaluate(styles);
  const localizedRejectStyles = await localized.reject.evaluate(styles);

  expect(localizedAcceptStyles).toEqual(localizedRejectStyles);
  expect(observed).toHaveLength(beforeReload);

  await page.screenshot({ path: info.outputPath('app-mobile-dark-es.png'), animations: 'disabled' });

  await info.attach('app-mobile-dark-es', { path: info.outputPath('app-mobile-dark-es.png') });

  const manualApp = endpoint(page, '/telemetry/errors');

  await localized.dialog.getByRole('button', { name: localized.copy.send }).click();

  const manualAppResponse = await manualApp;

  expect(manualAppResponse.status()).toBe(202);
  expect(manualAppResponse.request().postDataJSON()).toEqual({
    application: 'web-app',
    code: 'unhandled_exception',
    kind: 'RangeError',
    screen: 'dashboard',
  });
  expect(observed.filter(({ path }) => path === '/telemetry/visits').map(({ payload }) => payload)).toEqual([
    { page: 'docs', locale: 'en' },
    { page: 'app-dashboard', locale: 'en' },
  ]);
  expect(JSON.stringify(observed)).not.toContain(marker);

  // The real receiver retains its canonical Origin, with privacy headers honored independently.
  const wrongOrigin = await request.post('/telemetry/visits', {
    data: { page: 'docs', locale: 'en' },
    headers: { origin: 'https://denied.example.test' },
  });

  expect(wrongOrigin.status()).toBe(403);

  await info.attach('synthetic-network', { body: JSON.stringify(observed, null, 2), contentType: 'application/json' });
});

for (const signal of ['globalPrivacyControl', 'doNotTrack'] as const) {
  test(`honors ${signal} over a saved choice across site and app`, async ({ page }) => {
    await page.addInitScript(
      ({ key, name }) => {
        localStorage.setItem(key, 'accept:0-0-0-1');
        Object.defineProperty(navigator, name, { configurable: true, value: name === 'doNotTrack' ? '1' : true });
      },
      { key: browserConsentKey, name: signal },
    );

    const observed = requests(page);

    for (const path of ['/es/', '/app/es/foundations']) {
      await page.goto(path);

      const controls = privacy(page, 'es');

      await controls.opener.click();

      await expect(controls.accept).toBeDisabled();

      await expect(controls.dialog.getByText(controls.copy.blocked)).toBeVisible();

      await throwError(page, 'TypeError');

      await expect(controls.dialog.getByRole('button', { name: controls.copy.send })).toBeVisible();

      expect(observed).toEqual([]);
    }
  });
}
