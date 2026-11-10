import { expect, test } from './support/fixtures';

// Headless Chromium hides scrollbars by default, concealing their effect on layout width.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.describe('navigation with classic scrollbars', () => {
  test('keeps content width stable across loading, taller pages and language changes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/app/en/auth/sign-in');

    await expect(page.locator('[data-theme-switcher]')).toBeEnabled();

    await page.evaluate(() => document.fonts.ready);

    const initial = await page.evaluate(() => ({
      width: document.body.clientWidth,
      height: document.documentElement.scrollHeight,
    }));

    expect(initial.height).toBe(800);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route('**/chunk-*.js', async (route) => {
      await gate;

      await route.continue();
    });

    try {
      await page.getByRole('link', { name: 'Use a password', exact: true }).click();

      await expect(page.locator('app-page-loader [aria-hidden="true"]')).toBeVisible();

      await expect.poll(() => page.evaluate(() => document.body.clientWidth)).toBe(initial.width);

      await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBe(initial.height);
    } finally {
      release();
    }

    await expect(page).toHaveURL(/\/app\/en\/auth\/sign-in\/password$/);

    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();

    await expect.poll(() => page.evaluate(() => document.body.clientWidth)).toBe(initial.width);

    await page.getByRole('link', { name: 'Español', exact: true }).click();

    await expect(page).toHaveURL(/\/app\/es\/auth\/sign-in\/password$/);

    await expect(page.locator('[data-theme-switcher]')).toBeEnabled();

    await page.evaluate(() => document.fonts.ready);

    await expect.poll(() => page.evaluate(() => document.body.clientWidth)).toBe(initial.width);

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Longer content still scrolls; the fix must not hide or truncate the page.
    await page.mouse.wheel(0, 200);

    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

    await page.getByRole('link', { name: 'English', exact: true }).click();

    await expect(page).toHaveURL(/\/app\/en\/auth\/sign-in\/password$/);

    await page.getByRole('link', { name: 'Choose another method', exact: true }).click();

    await expect(page).toHaveURL(/\/app\/en\/auth\/sign-in$/);

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBe(initial.height);

    await expect.poll(() => page.evaluate(() => document.body.clientWidth)).toBe(initial.width);
  });
});

for (const { locale, passwordLink, loadingLabel } of [
  { locale: 'en', passwordLink: 'Use a password', loadingLabel: 'Loading page…' },
  { locale: 'es', passwordLink: 'Usar contraseña', loadingLabel: 'Cargando página…' },
]) {
  test(`the ${locale} navigation bar stays visible while a lazy page loads`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await page.goto(`/app/${locale}/auth/sign-in`);

    const switcher = page.locator('[data-theme-switcher]');

    await expect(switcher).toBeEnabled();

    const bar = page.locator('app-page-loader [aria-hidden="true"]');
    const announcement = page.locator('app-page-loader [role="status"]');
    const previous = page.getByRole('heading', { level: 1 });
    const heading = await previous.textContent();

    await expect(bar).toHaveCount(0);

    await expect(announcement).toBeEmpty();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;

    await page.route('**/chunk-*.js', async (route) => {
      requests++;

      await gate;

      await route.continue();
    });

    try {
      await page.getByRole('link', { name: passwordLink, exact: true }).click();

      await expect(bar).toBeVisible();

      await expect(previous).toHaveText(heading ?? '');

      await expect(announcement).toHaveText(loadingLabel);

      await expect(bar).toHaveCSS('pointer-events', 'none');

      await expect.poll(() => requests).toBeGreaterThan(0);

      const bounds = await bar.boundingBox();
      const contentWidth = await page.evaluate(() => document.body.clientWidth);

      expect(bounds?.y).toBe(0);
      expect(bounds?.height).toBe(4);
      expect(bounds?.width).toBe(contentWidth);

      await expect(bar.locator('div')).not.toHaveCSS('animation-name', 'none');

      await page.emulateMedia({ reducedMotion: 'reduce' });

      await expect(bar.locator('div')).toHaveCSS('animation-name', 'none');

      await page.screenshot({ path: info.outputPath(`${locale}-navigation-pending.png`), animations: 'disabled' });
    } finally {
      release();
    }

    await expect(page).toHaveURL(new RegExp(`/app/${locale}/auth/sign-in/password$`));

    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();

    await expect(bar).toHaveCount(0);

    await expect(announcement).toBeEmpty();
  });
}
