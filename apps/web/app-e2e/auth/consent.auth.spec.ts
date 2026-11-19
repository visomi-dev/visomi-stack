import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Page, Request } from '@playwright/test';

import { expect, signup, test } from './support/fixtures';

import { browserConsentKey, browserPrivacyCopy } from '@visomi-stack/web-shared-observability';

const marker = 'SYNTHETIC_PRIVATE_CONSENT_CONTENT';

function requests(page: Page) {
  const observed: { path: string; method: string; payload: unknown; status?: number }[] = [];
  const records = new WeakMap<Request, (typeof observed)[number]>();

  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;

    if (path.startsWith('/telemetry/')) {
      const record = { path, method: request.method(), payload: request.postDataJSON() };

      records.set(request, record);
      observed.push(record);
    }
  });
  page.on('response', (response) => {
    const record = records.get(response.request());

    if (record) {
      record.status = response.status();
    }
  });

  return observed;
}

function controls(page: Page, locale: 'en' | 'es' = 'en') {
  const copy = browserPrivacyCopy[locale];
  const notice = page.getByRole('region', { name: copy.title });

  return {
    copy,
    notice,
    opener: page.getByRole('button', { name: copy.pending }),
    dialog: page.getByRole('dialog', { name: copy.reportsTitle }),
    accept: notice.getByRole('button', { name: copy.accept, exact: true }),
    reject: notice.getByRole('button', { name: copy.reject, exact: true }),
  };
}

function endpoint(page: Page, path: string) {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.request().method() === 'POST',
  );
}

async function throwError(page: Page, kind: 'RangeError' | 'TypeError' | 'SyntaxError') {
  await page.evaluate(
    ({ kind, marker }) => {
      setTimeout(() => {
        throw new window[kind](marker);
      });
    },
    { kind, marker },
  );
}

async function compareChoices(page: Page, locale: 'en' | 'es' = 'en') {
  const { accept, reject } = controls(page, locale);
  const styles = (control: HTMLElement) => {
    const style = getComputedStyle(control);

    return [style.backgroundColor, style.color, style.borderColor, style.fontSize, style.width, style.height];
  };
  const yes = await accept.evaluate(styles);
  const no = await reject.evaluate(styles);

  expect(yes).toEqual(no);
}

test('keeps the notice in flow and separates manual reports from automatic consent', async ({
  page,
  request,
}, info) => {
  const observed = requests(page);
  const site = controls(page);

  await page.setViewportSize({ width: 1366, height: 900 });

  await page.emulateMedia({ colorScheme: 'light' });

  await page.goto('/app/en/home');

  await expect(page).toHaveURL(/\/auth\/sign-in/);

  await signup(page);

  await expect(controls(page).notice).toBeVisible();

  await expect
    .poll(() => readFile(join(process.env['VISOMI_E2E_TELEMETRY_DIR']!, 'otlp-http-span.txt'), 'utf8').catch(() => ''))
    .toBe('http.request');

  expect(observed).toEqual([]);

  await page.goto('/en/');

  await expect(site.notice).toBeVisible();

  await expect(page.getByRole('dialog')).toHaveCount(0);

  await compareChoices(page);

  await site.reject.focus();

  await page.keyboard.press('Tab');

  await expect(site.accept).toBeFocused();

  await page.keyboard.press('Tab');

  const purpose = site.notice.getByRole('link', { name: site.copy.purpose });

  await expect(purpose).toBeFocused();

  await page.screenshot({ path: info.outputPath('website-desktop-light-en.png'), animations: 'disabled' });

  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/en\/privacy\/$/);

  await expect(page.getByRole('heading', { name: site.copy.manualHeading })).toBeVisible();

  await expect(page.getByRole('contentinfo').getByRole('link', { name: site.copy.privacy })).toBeVisible();

  expect(observed).toEqual([]);

  await page.goto('/en/');

  const expectedFailures = await page.evaluate(async () => {
    await Promise.reject(new TypeError('synthetic handled error')).catch(() => undefined);

    const response = await fetch('/api/synthetic-consent-404');

    return response.status;
  });

  expect(expectedFailures).toBe(404);

  await expect(site.opener).toHaveCount(0);

  expect(observed).toEqual([]);

  await throwError(page, 'TypeError');

  await throwError(page, 'RangeError');

  await site.opener.focus();

  await site.opener.press('Enter');

  const previews = site.dialog.getByRole('listitem');

  await expect(previews).toHaveCount(2);

  await expect(site.dialog).not.toContainText(marker);

  expect(observed).toEqual([]);
  const report = endpoint(page, '/telemetry/errors');

  await previews.filter({ hasText: 'RangeError' }).getByRole('button', { name: site.copy.send }).click();

  const sent = await report;
  const reportHeaders = await sent.request().allHeaders();

  expect(reportHeaders['origin']).toBe(new URL(sent.url()).origin);
  expect(reportHeaders).not.toHaveProperty('cookie');
  expect(reportHeaders).not.toHaveProperty('referer');
  expect(sent.status()).toBe(202);
  expect(sent.request().postDataJSON()).toEqual({
    application: 'web-site',
    code: 'unhandled_exception',
    kind: 'RangeError',
    screen: 'home',
  });

  await expect(previews).toHaveCount(1);

  await expect(site.dialog.getByText(site.copy.sent)).toBeVisible();

  const decision = await page.evaluate((key) => localStorage.getItem(key), browserConsentKey);

  expect(decision).toBeNull();

  await previews.getByRole('button', { name: site.copy.discard }).click();

  await expect(previews).toHaveCount(0);

  await page.keyboard.press('Escape');

  await throwError(page, 'SyntaxError');

  await expect(site.opener).toBeVisible();

  await site.reject.click();

  await expect(site.notice.getByText(site.copy.off)).toBeVisible();

  await site.accept.click();

  await expect(site.notice.getByText(site.copy.on)).toBeVisible();

  await expect(site.opener).toHaveCount(0);

  expect(observed.map(({ path }) => path)).toEqual(['/telemetry/config', '/telemetry/errors']);

  const automatic = endpoint(page, '/telemetry/errors');

  await throwError(page, 'TypeError');

  const automaticResponse = await automatic;

  expect(automaticResponse.status()).toBe(202);
  const docs = endpoint(page, '/telemetry/visits');

  await page.goto('/en/docs/?private=' + marker + '#' + marker);

  const docsResponse = await docs;

  expect(docsResponse.status()).toBe(204);
  const dashboard = endpoint(page, '/telemetry/visits');

  await page.goto('/app/en/home?private=' + marker + '#' + marker);

  const visit = await dashboard;
  const visitHeaders = await visit.request().allHeaders();

  expect(visit.status()).toBe(204);
  expect(visit.request().postDataJSON()).toEqual({ page: 'app-dashboard', locale: 'en' });
  expect(visitHeaders).not.toHaveProperty('cookie');
  expect(visitHeaders).not.toHaveProperty('referer');
  const sidebar = page.locator('app-sidebar');

  await sidebar.getByRole('link', { name: 'Account', exact: true }).click();

  await expect(page).toHaveURL(/\/account$/);

  const returnToDashboard = endpoint(page, '/telemetry/visits');

  await sidebar.getByRole('link', { name: 'Home', exact: true }).click();

  const returnVisit = await returnToDashboard;

  expect(returnVisit.status()).toBe(204);

  await page.getByRole('contentinfo').getByRole('link', { name: site.copy.privacy }).click();

  await expect(page).toHaveURL(/\/en\/privacy\/$/);

  await site.reject.click();

  await expect(site.notice.getByText(site.copy.off)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });

  await page.emulateMedia({ colorScheme: 'dark' });

  const beforeReload = observed.length;

  await page.goto('/app/es/home');

  const localized = controls(page, 'es');

  await expect(localized.notice).toHaveCount(0);

  await throwError(page, 'RangeError');

  await localized.opener.click();

  expect(observed).toHaveLength(beforeReload);
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
    { page: 'app-dashboard', locale: 'en' },
  ]);
  expect(JSON.stringify(observed)).not.toContain(marker);
  const wrongOrigin = await request.post('/telemetry/visits', {
    data: { page: 'docs', locale: 'en' },
    headers: { origin: 'https://denied.example.test' },
  });

  expect(wrongOrigin.status()).toBe(403);
  const artifact = info.outputPath('synthetic-network.json');

  await writeFile(
    artifact,
    JSON.stringify({ requests: observed, foreignOrigin: wrongOrigin.status() }, null, 2) + '\n',
  );

  await info.attach('synthetic-network', { path: artifact, contentType: 'application/json' });
});

for (const [application, path] of [
  ['web-site', '/en/'],
  ['web-app', '/app/en/foundations'],
] as const) {
  test(`${application} measures only a new opted-in document and stops after revocation`, async ({ page }, info) => {
    const observed = requests(page);
    const privacy = controls(page);

    await page.goto(path);

    await expect(privacy.notice).toBeVisible();

    expect(observed).toEqual([]);

    await privacy.reject.click();

    await expect(privacy.notice.getByText(privacy.copy.off)).toBeVisible();

    await throwError(page, 'RangeError');

    await expect(privacy.opener).toBeVisible();

    expect(observed).toEqual([]);

    await privacy.accept.click();

    await expect(privacy.notice.getByText(privacy.copy.on)).toBeVisible();

    await expect(privacy.opener).toHaveCount(0);

    const automatic = endpoint(page, '/telemetry/errors');

    await throwError(page, 'TypeError');

    const error = await automatic;

    expect(error.status()).toBe(202);
    expect(error.request().postDataJSON()).toEqual({
      application,
      code: 'unhandled_exception',
      kind: 'TypeError',
      screen: 'home',
    });
    expect(observed.map(({ path }) => path)).toEqual(['/telemetry/config', '/telemetry/errors']);

    const performance = page.waitForResponse((response) => {
      if (new URL(response.url()).pathname !== '/telemetry/performance') {
        return false;
      }

      const measurements: { name: string }[] = response.request().postDataJSON().measurements;

      return measurements.some(({ name }) => name === 'load');
    });

    await page.goto(path + '?synthetic=' + marker + '#' + marker);

    const result = await performance;
    const headers = await result.request().allHeaders();

    expect(result.status()).toBe(202);
    expect(headers['origin']).toBe(new URL(result.url()).origin);
    expect(headers).not.toHaveProperty('cookie');
    expect(headers).not.toHaveProperty('referer');
    expect(result.request().postDataJSON()).toEqual({
      application,
      screen: 'home',
      measurements: expect.arrayContaining([{ name: 'load', value: expect.any(Number) }]),
    });

    const settings = await page.context().newPage();

    await settings.goto('/en/privacy/');

    await controls(settings).reject.click();

    await expect(controls(settings).notice.getByText(privacy.copy.off)).toBeVisible();

    const beforeReopening = observed.length;

    await throwError(page, 'SyntaxError');

    await expect(privacy.opener).toBeVisible();

    await page.reload();

    await throwError(page, 'SyntaxError');

    await expect(privacy.opener).toBeVisible();

    expect(observed).toHaveLength(beforeReopening);
    expect(JSON.stringify(observed)).not.toContain(marker);

    await info.attach('synthetic-performance-network', {
      body: JSON.stringify({ requests: observed, afterRevocation: observed.slice(beforeReopening) }, null, 2),
      contentType: 'application/json',
    });
  });
}

test('the mobile dark app keeps privacy controls in flow and links to Spanish public settings', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.emulateMedia({ colorScheme: 'dark' });

  const observed = requests(page);
  const app = controls(page, 'es');

  await page.goto('/app/es/foundations');

  await expect(app.notice).toBeVisible();

  await compareChoices(page, 'es');

  await expect(page.getByRole('dialog')).toHaveCount(0);

  await app.reject.focus();

  await page.keyboard.press('Tab');

  await expect(app.accept).toBeFocused();

  await page.screenshot({ path: info.outputPath('app-mobile-dark-es.png'), animations: 'disabled' });

  await page.keyboard.press('Tab');

  const purpose = app.notice.getByRole('link', { name: app.copy.purpose });

  await expect(purpose).toBeFocused();

  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/es\/privacy\/$/);

  expect(observed).toEqual([]);
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
    const localized = controls(page, 'es');

    await page.goto('/es/privacy/');

    await expect(localized.accept).toBeDisabled();

    await expect(localized.notice.getByText(localized.copy.blocked)).toBeVisible();

    await throwError(page, 'TypeError');

    await localized.opener.click();

    await expect(localized.dialog.getByRole('button', { name: localized.copy.send })).toBeVisible();

    await page.goto('/app/es/foundations');

    await throwError(page, 'TypeError');

    await localized.opener.click();

    await expect(localized.dialog.getByRole('button', { name: localized.copy.send })).toBeVisible();

    expect(observed).toEqual([]);
  });
}
