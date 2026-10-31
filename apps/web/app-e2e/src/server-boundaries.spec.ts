import { expect, test } from '@playwright/test';

test('does not expose raw Angular HTML templates, including encoded paths and HEAD requests', async ({ request }) => {
  for (const locale of ['en', 'es']) {
    for (const filename of ['index.csr.html', 'index.csr%2Ehtml', '%69ndex.csr.html']) {
      const path = `/app/${locale}/${filename}`;
      const document = await request.get(path);
      const html = await document.text();
      const head = await request.head(path);

      expect(document.status()).toBe(404);
      expect(head.status()).toBe(404);
      expect(html).not.toContain('__VISOMI_CSP_NONCE__');
    }
  }
});

test('routes index.html through Angular with a fresh nonce and working hydration', async ({ page, request }) => {
  const failures: string[] = [];

  page.on('pageerror', (error) => failures.push(error.name));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      failures.push(message.text());
    }
  });

  for (const locale of ['en', 'es']) {
    const path = `/app/${locale}/index.html`;
    const response = await request.get(path);
    const html = await response.text();
    const nonce = html.match(/ngcspnonce="([^"]+)"/i)?.[1];

    expect(response.status()).toBe(200);
    expect(nonce).toBeTruthy();
    expect(nonce).not.toBe('__VISOMI_CSP_NONCE__');
    expect(response.headers()['content-security-policy']).toContain(`'nonce-${nonce}'`);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(html).not.toContain('__VISOMI_CSP_NONCE__');

    await page.goto(path);

    await expect(page.locator('app-root')).not.toHaveAttribute('ngh');

    await expect(page.locator('body')).toHaveCSS('font-family', /Inter/);

    expect(failures).toEqual([]);
  }
});

test('returns a fixed 400 for malformed path encoding without reflecting private material', async ({ request }) => {
  for (const path of ['/app/en/%zz', '/app/es/%', '/en/%E0%A4%A', '/api/%C3%28']) {
    const response = await request.get(path + '?private=SYNTHETIC_PRIVATE_QUERY');
    const body = await response.json();

    expect(response.status()).toBe(400);
    expect(body).toEqual({ error: 'request_invalid' });
  }

  const validPercent = await request.get('/app/en/%25');

  expect(validPercent.status()).toBe(404);
});
