import { expect, test } from '@playwright/test';

const routes = ['/en/', '/es/', '/docs/'] as const;

test.describe('site smoke', () => {
  for (const route of routes) {
    test(route, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });

      expect(response?.ok()).toBeTruthy();
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('h1').first()).toBeVisible();
    });
  }

  for (const route of routes) {
    test(`keeps the localized brand home link accessible on mobile and desktop: ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(route);

      const homeLink = page.getByRole('link', {
        name: route === '/es/' ? 'visomi/stack — Inicio' : 'visomi/stack — Home',
        exact: true,
      });

      await expect(homeLink).toBeVisible();
      await expect(homeLink).toHaveAttribute('href', route === '/es/' ? '/es/' : '/en/');

      await page.setViewportSize({ width: 1280, height: 800 });

      await expect(homeLink).toBeVisible();
    });
  }

  test('persists the selected theme across navigation', async ({ page }) => {
    await page.addInitScript(() => {
      if (!window.localStorage.getItem('themis.theme')) window.localStorage.setItem('themis.theme', 'light');
    });
    await page.goto('/en/');

    const themeSwitcher = page.getByRole('button', { name: 'Switch to dark theme' });

    await themeSwitcher.click();

    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.localStorage.getItem('themis.theme'))).toBe('dark');

    await page.goto('/docs/');

    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});
