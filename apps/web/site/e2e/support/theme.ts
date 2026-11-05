import { expect, type Page } from '@playwright/test';

export async function selectTheme(page: Page, theme: string): Promise<void> {
  const switcher = page.locator('[data-theme-switcher]');
  const pressed = String(theme === 'dark');

  await expect(switcher).toBeEnabled();

  const current = await switcher.getAttribute('aria-pressed');

  if (current !== pressed) {
    await switcher.click();
  }

  await expect(switcher).toHaveAttribute('aria-pressed', pressed);
}
