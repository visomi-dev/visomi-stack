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

  test('persists the selected theme across navigation', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('themis.theme', 'light'));
    await page.goto('/en/');

    const themeSwitcher = page.getByRole('button', { name: 'Switch to dark theme' });

    await themeSwitcher.click();

    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(themeSwitcher).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.localStorage.getItem('themis.theme'))).toBe('dark');

    await page.goto('/docs/');

    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});
