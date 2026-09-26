import { expect, test } from '@playwright/test';

test('offers password registration before entering an email and preserves the chosen method on reload', async ({
  page,
}) => {
  await page.goto('/app/en/auth/sign-up');
  const alternative = page.getByRole('link', { name: 'Use password instead' });

  await expect(alternative).toBeVisible();
  await expect(alternative).toHaveAttribute('href', /\?method=password$/);
  await page.screenshot({ path: 'tmp/auth-captures/registration-options-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'tmp/auth-captures/registration-options-mobile.png', fullPage: true });
  await alternative.click();
  await expect(page.getByLabel('Password', { exact: true })).toBeEditable();
  await page.reload();
  await expect(page.getByLabel('Password', { exact: true })).toBeEditable();
  await page.getByRole('link', { name: 'Use a passkey instead' }).click();
  await expect(page.getByRole('button', { name: 'Create account with passkey' })).toBeVisible();
});
