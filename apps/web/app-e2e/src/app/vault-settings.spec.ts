import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { createCredentials, registerAndAuthenticate } from '../support/auth';

// Isolate memory-only authentication budgets between scenarios, never between proofs.
test.beforeEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});
test.afterEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});

async function confirm(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');

  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue with a passkey', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('enrolls a local PIN with real Argon2, recovers the same key and rejects revoked browser enrollment', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await registerAndAuthenticate(page, request, createCredentials().email);
  await page.goto('/app/en/security/vault');
  await expect(page.getByRole('heading', { name: 'Encrypted vault', exact: true })).toBeVisible();
  await page.getByLabel('Six-digit vault PIN', { exact: true }).fill('829374');
  await page.getByRole('button', { name: 'Create a new vault', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Vault PIN saved on this browser.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include('app-vault-settings')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();

  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'Reveal recovery key', exact: true }).click();
  await confirm(page);
  const recovery = await page.locator('app-vault-settings code').innerText();

  expect(recovery).toMatch(/^stack1\.[A-Za-z0-9_-]{43}$/);
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await expect(page.locator('app-vault-settings code')).toHaveCount(0);
  await page.getByLabel('Six-digit vault PIN', { exact: true }).fill('829375');
  await page.getByRole('button', { name: 'Unlock with browser PIN', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Vault action failed' })).toBeVisible();
  await page.getByLabel('Six-digit vault PIN', { exact: true }).fill('829374');
  await page.getByRole('button', { name: 'Unlock with browser PIN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  await page.getByLabel('Six-digit vault PIN', { exact: true }).fill('836274');
  await page.getByRole('button', { name: 'Change vault PIN', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Vault PIN saved on this browser.', { exact: false })).toBeVisible();
  const checked = page.waitForResponse(
    (response) => response.url().includes('/vault-unlock/') && response.url().endsWith('/config'),
  );

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await checked;
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Vault locked', { exact: true })).toBeVisible();
  await page.getByLabel('Vault recovery key', { exact: true }).fill(recovery);
  await page.getByRole('button', { name: 'Unlock with recovery key', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke vault PIN', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Vault locked', { exact: true })).toBeVisible();
  await page.getByLabel('Six-digit vault PIN', { exact: true }).fill('829374');
  await page.getByRole('button', { name: 'Unlock with browser PIN', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Vault action failed' })).toBeVisible();
  await expect(page.getByText('Vault locked', { exact: true })).toBeVisible();
  // Recovery remains valid after revocation because the encrypted continuity anchor was not erased.
  await page.getByLabel('Vault recovery key', { exact: true }).fill(recovery);
  await page.getByRole('button', { name: 'Unlock with recovery key', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  await page.goto('/app/es/security/vault');
  await expect(page.getByRole('heading', { name: 'Bóveda cifrada', exact: true })).toBeVisible();
  await expect(page.getByText('Bóveda bloqueada', { exact: true })).toBeVisible();
});
