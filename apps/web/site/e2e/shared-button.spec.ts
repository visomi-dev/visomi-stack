import { writeFile } from 'node:fs/promises';
import { brotliCompressSync, gzipSync } from 'node:zlib';

import { expect, test } from '@playwright/test';

import { disablePerformanceCapture } from './support/performance';

for (const locale of ['en', 'es']) {
  test(`Astro SSR emits native controls with shared styles in ${locale}`, async ({ page, request }) => {
    const path = `/${locale}/button/`;
    const response = await request.get(path);
    const markup = await response.text();

    expect(response.status()).toBe(200);
    expect(markup).toMatch(/<button[^>]*data-increment/);
    expect(markup).toContain('enabled:hover:bg-blue-700');
    expect(response.headers()['content-security-policy']).not.toContain('unsafe-inline');
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });

    await page.goto(path);

    const primary = page.getByRole('button', { name: locale === 'es' ? 'Sumar uno' : 'Add one', exact: true });
    const secondary = page.getByRole('button', { name: locale === 'es' ? 'Reiniciar' : 'Reset', exact: true });

    await expect(primary).toHaveAttribute('type', 'button');

    await primary.click();

    await expect(page.locator('[data-count]')).toHaveText('1');

    await secondary.click();

    await expect(page.locator('[data-count]')).toHaveText('0');

    await expect(page.locator('[data-disabled]')).toBeDisabled();

    await primary.focus();

    await page.keyboard.press('Space');

    await expect(page.locator('[data-count]')).toHaveText('1');

    await expect(primary).toHaveCSS('outline-style', 'solid');

    await expect(primary).toHaveCSS('outline-width', '2px');

    const lightSurface = await secondary.evaluate((element) => getComputedStyle(element).backgroundColor);

    await page.locator('[data-theme-select]').selectOption('dark');

    await expect(page.locator('html')).toHaveClass('dark');

    const darkSurface = await secondary.evaluate((element) => getComputedStyle(element).backgroundColor);

    expect(darkSurface).not.toBe(lightSurface);

    await page.setViewportSize({ width: 360, height: 800 });

    const heights = await page
      .locator('[data-button-demo] button')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));

    expect(heights.every((height) => height >= 44)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`native Astro form submission works without JavaScript in ${locale}`, async ({ browser }, info) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: info.project.use.baseURL });

    try {
      const page = await context.newPage();

      await page.goto(`/${locale}/button/`);

      await expect(
        page.getByRole('button', { name: locale === 'es' ? 'Sumar uno' : 'Add one', exact: true }),
      ).toBeVisible();

      await expect(page.locator('[data-disabled]')).toBeDisabled();

      await page.getByRole('button', { name: locale === 'es' ? 'Enviar formulario' : 'Submit form' }).click();

      await expect(page).toHaveURL(new RegExp(`/${locale}/button/\\?action=submit$`));

      const confirmation = locale === 'es' ? 'Formulario enviado.' : 'Form submitted.';

      await expect(page.getByRole('status').filter({ hasText: confirmation })).toHaveText(confirmation);
    } finally {
      await context.close();
    }
  });
}

test('the website loads small theme, error reporting and native demo scripts', async ({ page }, info) => {
  await disablePerformanceCapture(page);

  const responses: Promise<{ path: string; raw: number; gzip: number; brotli: number }>[] = [];

  page.on('response', (response) => {
    if (response.request().resourceType() === 'script') {
      responses.push(
        (async () => {
          const body = await response.body();

          return {
            path: new URL(response.url()).pathname,
            raw: body.length,
            gzip: gzipSync(body, { level: 9 }).length,
            brotli: brotliCompressSync(body).length,
          };
        })(),
      );
    }
  });

  await page.goto('/en/button/');

  await page.locator('[data-increment]').click();

  await expect(page.locator('[data-count]')).toHaveText('1');

  const resources = await Promise.all(responses);
  const totalRaw = resources.reduce((total, resource) => total + resource.raw, 0);

  expect(resources).toHaveLength(3);
  expect(resources.some((resource) => resource.path.includes('button-demo.'))).toBe(true);
  expect(totalRaw).toBeLessThan(6144);

  await writeFile(info.outputPath('javascript-cost.json'), JSON.stringify({ resources, totalRaw }, null, 2));
});
