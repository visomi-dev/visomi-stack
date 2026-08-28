import { expect, test } from '@playwright/test';

const routes = ['/en/', '/es/'] as const;

test.describe('site smoke', () => {
  for (const route of routes) {
    test(route, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });

      expect(response?.ok()).toBeTruthy();
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('h1').first()).toBeVisible();
    });
  }
});
