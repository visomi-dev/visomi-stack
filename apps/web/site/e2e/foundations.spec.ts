import { expect, test } from '@playwright/test';

function route(locale = 'en') {
  return `/${locale}/`;
}

for (const locale of ['en', 'es']) {
  test(`renders ${locale} through Express and loads assets without errors`, async ({ page, request }, info) => {
    const path = route(locale);
    const response = await request.get(path);
    const markup = await response.text();

    expect(response.status()).toBe(200);
    expect(markup).toContain(`<html lang="${locale}"`);
    expect(markup).toContain(locale === 'en' ? 'One visual language.' : 'Un mismo lenguaje visual.');
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });

    await page.goto(path);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      locale === 'en' ? 'One visual language.' : 'Un mismo lenguaje visual.',
    );

    await page.evaluate(() => document.fonts.ready);

    await expect(page.locator('body')).toHaveCSS('font-family', /Inter/);

    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-family', /Manrope/);

    await page.reload();

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    expect(errors).toEqual([]);
    expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers()['content-security-policy']).not.toContain("'unsafe-inline'");
    const missing0 = await request.get('/api/missing');

    expect(missing0.status()).toBe(404);
    const missing1 = await request.get('/app/es/missing');

    expect(missing1.status()).toBe(404);
    const missing2 = await request.get('/missing/');

    expect(missing2.status()).toBe(404);

    await page.screenshot({
      path: info.outputPath(`foundations-${locale}-desktop.png`),
      fullPage: true,
      animations: 'disabled',
    });
  });
}

test('remembers explicit themes and follows system changes only in system mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });

  await page.addInitScript(() => {
    if (!localStorage.getItem('visomi.theme')) {
      localStorage.setItem('visomi.theme', 'dark');
    }
  });

  await page.goto(route());

  const control = page.locator('[data-theme-select]');

  await expect(page.locator('html')).toHaveClass('dark');

  await expect(control).toHaveValue('dark');

  await control.selectOption('light');

  await expect(page.locator('html')).not.toHaveClass('dark');

  await page.emulateMedia({ colorScheme: 'dark' });

  await expect(page.locator('html')).not.toHaveClass('dark');

  await control.selectOption('system');

  await expect(page.locator('html')).toHaveClass('dark');

  await page.emulateMedia({ colorScheme: 'light' });

  await expect(page.locator('html')).not.toHaveClass('dark');

  await control.selectOption('dark');

  const stored = await page.evaluate(() => localStorage.getItem('visomi.theme'));

  expect(stored).toBe('dark');

  await page.reload();

  await expect(control).toHaveValue('dark');
});

test('keeps theme controls usable when storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('synthetic_storage_blocked');
      },
    });
  });

  await page.emulateMedia({ colorScheme: 'dark' });

  await page.goto(route());

  await expect(page.locator('html')).toHaveClass('dark');

  await page.locator('[data-theme-select]').selectOption('light');

  await expect(page.locator('html')).not.toHaveClass('dark');
});

test('supports keyboard focus, reduced motion and a narrow viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });

  await page.goto(route('es'));

  await page.keyboard.press('Tab');

  await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();

  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');

  const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

  expect(overflowing).toBe(false);

  await page.locator('[data-theme-select]').focus();

  await expect(page.locator('[data-theme-select]')).toHaveCSS('outline-style', 'solid');

  await page.evaluate(() => document.fonts.ready);

  await page.screenshot({
    path: info.outputPath('foundations-es-mobile-dark.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('serves readable content with JavaScript disabled', async ({ browser }, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: info.project.use.baseURL });

  try {
    const page = await context.newPage();

    await page.goto(route('es'));

    await expect(page.getByRole('heading', { name: 'Un mismo lenguaje visual.' })).toBeVisible();
  } finally {
    await context.close();
  }
});
