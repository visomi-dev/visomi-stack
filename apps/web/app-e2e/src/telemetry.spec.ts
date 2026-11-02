import { test, expect } from '@playwright/test';

test('measures Angular router transitions without URLs, parameters, fragments or navigation IDs', async ({ page }) => {
  const reports: { payload: Record<string, unknown>; status: number }[] = [];

  await page.route('**/telemetry/performance', async (route) => {
    const response = await route.fetch();

    reports.push({ payload: route.request().postDataJSON(), status: response.status() });

    await route.fulfill({ response });
  });

  await page.goto('/app/en/');

  await expect.poll(() => reports.length).toBeGreaterThan(0);

  await page.evaluate(() => {
    // Exercise the real router through its browser history listener, without a test-only application API.
    history.pushState(null, '', '?customer=SYNTHETIC_PRIVATE_ROUTE#SYNTHETIC_PRIVATE_ROUTE');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  await expect
    .poll(
      () =>
        reports.filter(({ payload }) =>
          (payload['measurements'] as { name: string }[]).some(({ name }) => name === 'route_completed'),
        ).length,
    )
    .toBe(1);

  const transition = reports.find(({ payload }) =>
    (payload['measurements'] as { name: string }[]).some(({ name }) => name === 'route_completed'),
  )!;

  expect(transition.status).toBe(202);
  expect(transition.payload).toEqual({
    application: 'web-app',
    screen: 'home',
    measurements: [{ name: 'route_completed', value: expect.any(Number) }],
  });
  expect(JSON.stringify(reports)).not.toContain('SYNTHETIC_PRIVATE_ROUTE');
});

test('measures real page performance without exporting URLs, attribution or browser identifiers', async ({ page }) => {
  const reports: { payload: Record<string, unknown>; status: number; headers: Record<string, string> }[] = [];

  await page.route('**/telemetry/performance', async (route) => {
    const response = await route.fetch();

    reports.push({
      payload: route.request().postDataJSON(),
      status: response.status(),
      headers: route.request().headers(),
    });

    await route.fulfill({ response });
  });

  await page.goto('/app/en/?secret=SYNTHETIC_PRIVATE_PERFORMANCE');

  await expect
    .poll(() =>
      reports.flatMap((report) => report.payload['measurements'] as { name: string }[]).map(({ name }) => name),
    )
    .toEqual(expect.arrayContaining(['load', 'ttfb', 'fcp']));

  for (const report of reports) {
    expect(report.status).toBe(202);
    expect(Object.keys(report.payload).sort()).toEqual(['application', 'measurements', 'screen']);
    expect(report.payload['application']).toBe('web-app');
    expect(report.payload['screen']).toBe('home');
    expect(report.headers).not.toHaveProperty('cookie');
    expect(report.headers).not.toHaveProperty('referer');
    for (const measurement of report.payload['measurements'] as { name: string; value: number }[]) {
      expect(Object.keys(measurement).sort()).toEqual(['name', 'value']);
      expect(['cls', 'fcp', 'inp', 'lcp', 'ttfb', 'dom_interactive', 'dom_content_loaded', 'load']).toContain(
        measurement.name,
      );
      expect(Number.isFinite(measurement.value)).toBe(true);
      expect(measurement.value).toBeGreaterThanOrEqual(0);
    }
  }
  expect(JSON.stringify(reports.map(({ payload }) => payload))).not.toContain('SYNTHETIC_PRIVATE_PERFORMANCE');
});

test('reports browser failures without private data and keeps source maps private', async ({ page, request }) => {
  const reports: { payload: Record<string, unknown>; status: number }[] = [];

  await page.route('**/telemetry/errors', async (route) => {
    const response = await route.fetch();

    reports.push({ payload: route.request().postDataJSON(), status: response.status() });

    await route.fulfill({ response });
  });

  const configuration = page.waitForResponse((response) => response.url().endsWith('/telemetry/config'));

  await page.goto('/app/en/');

  const response = await configuration;
  const config = await response.json();
  const asset = config.assets.find((entry: { path: string }) => entry.path.startsWith('/app/'));

  expect(response.status()).toBe(200);
  expect(config.assets.length).toBeGreaterThan(0);

  await page.evaluate(() => {
    const marker = 'SYNTHETIC_PRIVATE_BROWSER_MARKER';
    const error = new TypeError(marker);

    window.dispatchEvent(
      new ErrorEvent('error', {
        error,
        message: marker,
        filename: window.location.origin + '/private/' + marker,
        lineno: 1,
        colno: 1,
      }),
    );
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: { customer: marker },
      }),
    );
  });

  await page.evaluate((asset) => {
    const error = new RangeError('SYNTHETIC_PRIVATE_BROWSER_MARKER');

    error.stack = `RangeError: SYNTHETIC_PRIVATE_BROWSER_MARKER\n at synthetic (${window.location.origin}${asset.path}:1:1)`;
    window.dispatchEvent(
      new ErrorEvent('error', {
        error,
        filename: window.location.origin + asset.path,
        lineno: 1,
        colno: 1,
      }),
    );
  }, asset);

  await expect.poll(() => reports.length).toBe(3);

  expect(reports.map((report) => report.status)).toEqual([202, 202, 202]);
  expect(reports.map((report) => report.payload)).toEqual(
    expect.arrayContaining([
      { application: 'web-app', code: 'unhandled_exception', kind: 'TypeError', screen: 'home' },
      { application: 'web-app', code: 'unhandled_exception', kind: 'unknown', screen: 'home' },
      {
        application: 'web-app',
        code: 'unhandled_exception',
        kind: 'RangeError',
        screen: 'home',
        location: { asset: asset.id, line: 1, column: 1 },
      },
    ]),
  );
  expect(JSON.stringify(reports)).not.toContain('SYNTHETIC_PRIVATE_BROWSER_MARKER');
  for (const asset of config.assets.slice(0, 2)) {
    const sourceMap = await request.get(asset.path + '.map');
    const encodedMap = await request.get(asset.path + '%2Emap');

    expect(sourceMap.status()).toBe(404);
    expect(encodedMap.status()).toBe(404);
  }
});

test('uses a fresh CSP nonce per response for SSR and hydration scripts', async ({ request }) => {
  const first = await request.get('/app/en/');
  const second = await request.get('/app/es/');
  const firstHtml = await first.text();
  const secondHtml = await second.text();
  const firstNonce = firstHtml.match(/ngcspnonce="([^"]+)"/i)?.[1];
  const secondNonce = secondHtml.match(/ngcspnonce="([^"]+)"/i)?.[1];

  expect(firstNonce).toBeTruthy();
  expect(secondNonce).not.toBe(firstNonce);
  expect(first.headers()['content-security-policy']).toContain(`'nonce-${firstNonce}'`);
  expect(second.headers()['content-security-policy']).toContain(`'nonce-${secondNonce}'`);
  expect(first.headers()['content-security-policy']).not.toContain('unsafe-inline');
  expect(first.headers()['cache-control']).toBe('no-store');
  expect(firstHtml).not.toContain('__VISOMI_CSP_NONCE__');
  expect(firstHtml).toMatch(/<script[^>]+nonce="[^"]+"[^>]*>/);
});
