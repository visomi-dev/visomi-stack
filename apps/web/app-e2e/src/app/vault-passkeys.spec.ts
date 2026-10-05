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

test('enrolls native PRF vault unlock, preserves recovery continuity and revokes only vault access', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await registerAndAuthenticate(page, request, createCredentials().email, '', { prf: true });
  await page.goto('/app/en/security/vault');
  await page.getByLabel('Six-digit vault PIN', { exact: true }).fill('829374');
  await page.getByRole('button', { name: 'Create a new vault', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Vault PIN saved on this browser.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal recovery key', exact: true }).click();
  await confirm(page);
  const recovery = await page.locator('app-vault-settings code').innerText();
  const requests: Record<string, unknown>[] = [];

  page.on('request', (request) => {
    if (request.url().includes('/vault-unlock/') && request.method() === 'POST')
      requests.push(request.postDataJSON() as Record<string, unknown>);
  });
  await page.getByRole('button', { name: 'Enable passkey vault unlock', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Passkey vault unlock saved.', { exact: false })).toBeVisible();
  expect(requests.some((body) => 'enrollmentProofId' in body)).toBe(true);
  for (const body of requests) {
    expect(body).not.toHaveProperty('prfOutput');
    if ('response' in body) expect(body.response).not.toHaveProperty('clientExtensionResults');
    expect(JSON.stringify(body)).not.toContain(recovery);
  }
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal recovery key', exact: true }).click();
  await confirm(page);
  await expect(page.locator('app-vault-settings code')).toHaveText(recovery);
  await page.reload();
  await expect(page.getByText('Vault locked', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include('app-vault-passkeys')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();

  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'Revoke passkey vault unlock', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Vault locked', { exact: true })).toBeVisible();
  await expect(page.getByText('No passkey is enrolled for vault unlock.', { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/auth/session')).json()).data.authenticated).toBe(true);
  await page.getByLabel('Vault recovery key', { exact: true }).fill(recovery);
  await page.getByRole('button', { name: 'Unlock with recovery key', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  await page.goto('/app/es/security/vault');
  await expect(
    page.getByRole('heading', { name: 'Desbloqueo de bóveda con clave de acceso', exact: true }),
  ).toBeVisible();
});

test('rejects a native passkey without PRF without publishing an envelope or replacing the unlocked vault', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await registerAndAuthenticate(page, request, createCredentials().email);
  await page.goto('/app/en/security/vault');
  await page.getByLabel('Six-digit vault PIN', { exact: true }).fill('829374');
  await page.getByRole('button', { name: 'Create a new vault', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Vault PIN saved on this browser.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Enable passkey vault unlock', exact: true }).click();
  await confirm(page);
  await expect(page.locator('app-vault-passkeys').getByRole('alert')).toContainText('No weaker fallback was used.');
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  const session = (await (await page.request.get('/api/auth/session')).json()).data;
  const methods = await page.request.get(`/api/vault-unlock/${session.user.accountId}/methods`);

  expect(methods.ok()).toBe(true);
  expect((await methods.json()).data).toEqual([]);
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await expect(page.getByLabel('Six-digit vault PIN', { exact: true })).toHaveValue('');
  await page.getByLabel('Six-digit vault PIN', { exact: true }).fill('829374');
  await page.getByRole('button', { name: 'Unlock with browser PIN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
});
