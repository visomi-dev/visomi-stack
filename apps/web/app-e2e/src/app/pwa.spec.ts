import { expect, test } from '@playwright/test';

import { authenticateViaDeterministicTestSession, createCredentials } from '../support/auth';
import { signInRoute } from '../support/routes';

test('installs a locale-scoped worker without caching session authority or replacing user storage', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.goto(signInRoute);
  const manifestResponse = await request.get('/app/en/manifest.webmanifest');

  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()['cache-control']).toBe('no-cache');
  const manifest = (await manifestResponse.json()) as { name: string; icons: { src: string; sizes: string }[] };

  expect(manifest.name).toBe('Visomi Stack');
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
  for (const icon of manifest.icons) {
    const response = await request.get(`/app/en/${icon.src}`);

    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
  }
  const configResponse = await request.get('/app/en/ngsw.json');

  expect(configResponse.headers()['cache-control']).toBe('no-cache');
  const config = (await configResponse.json()) as {
    index: string;
    dataGroups: unknown[];
    navigationRequestStrategy: string;
  };

  expect(config.index).toBe('/app/en/index.csr.html');
  expect(config.dataGroups).toEqual([]);
  expect(config.navigationRequestStrategy).toBe('freshness');
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();

          return registration?.active?.state;
        }),
      { timeout: 60_000 },
    )
    .toBe('activated');
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  const anonymous = await page.evaluate(async () => {
    const response = await fetch('/api/auth/session');

    return {
      body: (await response.json()) as { data: { authenticated: boolean } },
      cache: response.headers.get('Cache-Control'),
    };
  });

  expect(anonymous.body.data.authenticated).toBe(false);
  expect(anonymous.cache).toBe('no-store');
  await page.evaluate(() => localStorage.setItem('pwa-storage-probe', 'retained'));
  const credentials = createCredentials();

  await authenticateViaDeterministicTestSession(page, request, credentials.email, credentials.password);
  const authenticated = await page.evaluate(async () => {
    const response = await fetch('/api/auth/session');
    const data = (await response.json()) as { data: { user: { email: string } } };

    return {
      email: data.data.user.email,
      retained: localStorage.getItem('pwa-storage-probe'),
      cache: response.headers.get('Cache-Control'),
    };
  });

  expect(authenticated).toEqual({ email: credentials.email, retained: 'retained', cache: 'no-store' });
  const cached = await page.evaluate(async () => {
    const requests = await Promise.all((await caches.keys()).map(async (name) => (await caches.open(name)).keys()));

    return requests.flat().map((entry) => entry.url);
  });

  expect(cached.some((url) => new URL(url).pathname.startsWith('/api/'))).toBe(false);
});
