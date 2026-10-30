import { expect, test } from '@playwright/test';

for (const locale of ['en', 'es']) {
  test(`SSR includes a native button and hydration reuses it in ${locale}`, async ({ page, request }) => {
    const path = `/app/${locale}/`;
    const response = await request.get(path);
    const markup = await response.text();

    expect(response.status()).toBe(200);
    expect(markup).toMatch(/<button[^>]*data-increment/);
    expect(markup).not.toContain('ngskiphydration');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route('**/main-*.js', async (route) => {
      await gate;

      await route.continue();
    });

    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));

    try {
      await page.goto(path, { waitUntil: 'commit' });

      await expect(page.locator('button[data-increment]')).toBeVisible();

      await page.evaluate(() => {
        const probe = window as typeof window & {
          sharedButtonBeforeHydration?: Element | null;
          shellBeforeHydration?: Element | null;
        };

        probe.sharedButtonBeforeHydration = document.querySelector('button[data-increment]');
        probe.shellBeforeHydration = document.querySelector('main');
      });
    } finally {
      release();
    }

    await expect(page.locator('app-root')).not.toHaveAttribute('ngh');

    await expect(
      page.getByRole('button', { name: locale === 'es' ? 'Sumar uno' : 'Add one', exact: true }),
    ).toBeVisible();

    await page.locator('button[data-increment]').click();

    await expect(page.locator('[data-count]')).toHaveText('1');

    const reused = await page.evaluate(() => {
      const probe = window as typeof window & {
        sharedButtonBeforeHydration?: Element | null;
        shellBeforeHydration?: Element | null;
      };

      return (
        probe.sharedButtonBeforeHydration === document.querySelector('button[data-increment]') &&
        probe.shellBeforeHydration === document.querySelector('main')
      );
    });

    expect(reused).toBe(true);

    await page.locator('button[data-reset]').click();

    await expect(page.locator('[data-count]')).toHaveText('0');

    await expect(page.locator('button[data-disabled]')).toBeDisabled();

    expect(errors).toEqual([]);
  });
}

test('the native Angular button remains available without JavaScript', async ({ browser }, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: info.project.use.baseURL });

  try {
    const page = await context.newPage();

    await page.goto('/app/en/');

    await expect(page.getByRole('button', { name: 'Add one', exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Unavailable', exact: true })).toBeDisabled();
  } finally {
    await context.close();
  }
});
