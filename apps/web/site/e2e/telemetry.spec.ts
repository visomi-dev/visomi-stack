import { test, expect } from '@playwright/test';

test('measures real page performance without exporting URLs, attribution or browser identifiers', async ({ page }) => {
  const reports: { payload: Record<string, unknown>; status: number; headers: Record<string, string> }[] = [];
  const scripts: Promise<number>[] = [];

  page.on('response', (response) => {
    if (response.request().resourceType() === 'script') {
      scripts.push(response.body().then((body) => body.length));
    }
  });

  await page.route('**/telemetry/performance', async (route) => {
    const response = await route.fetch();

    reports.push({
      payload: route.request().postDataJSON(),
      status: response.status(),
      headers: route.request().headers(),
    });

    await route.fulfill({ response });
  });

  await page.goto('/en/?secret=SYNTHETIC_PRIVATE_PERFORMANCE');

  await expect
    .poll(() => reports.flatMap((report) => report.payload.measurements as { name: string }[]).map(({ name }) => name))
    .toEqual(expect.arrayContaining(['load', 'ttfb', 'fcp']));

  const sizes = await Promise.all(scripts);

  expect(sizes).toHaveLength(3);
  expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThan(65536);

  for (const report of reports) {
    expect(report.status).toBe(202);
    expect(Object.keys(report.payload).sort()).toEqual(['application', 'measurements', 'screen']);
    expect(report.payload.application).toBe('web-site');
    expect(report.payload.screen).toBe('home');
    expect(report.headers).not.toHaveProperty('cookie');
    expect(report.headers).not.toHaveProperty('referer');
    for (const measurement of report.payload.measurements as { name: string; value: number }[]) {
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

  await page.goto('/en/ui/');

  const response = await configuration;
  const config = await response.json();
  const asset = config.assets.find((entry: { path: string }) => entry.path.startsWith('/_astro/'));

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
    window.dispatchEvent(
      new ErrorEvent('error', {
        error: new RangeError('SYNTHETIC_PRIVATE_BROWSER_MARKER'),
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
      { application: 'web-site', code: 'unhandled_exception', kind: 'TypeError', screen: 'ui' },
      { application: 'web-site', code: 'unhandled_rejection', kind: 'unknown', screen: 'ui' },
      {
        application: 'web-site',
        code: 'unhandled_exception',
        kind: 'RangeError',
        screen: 'ui',
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
