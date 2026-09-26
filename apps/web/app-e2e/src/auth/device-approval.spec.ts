import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import {
  addVirtualAuthenticator,
  authenticateViaDeterministicTestSession,
  createCredentials,
  registerAndAuthenticate,
} from '../support/auth';

test.beforeEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});
test.afterEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});

test('approves from a second device with real passkey proof and completes requester enrollment', async ({
  page,
  request,
  browser,
}) => {
  const credentials = createCredentials();

  await registerAndAuthenticate(page, request, credentials.email, credentials.password);
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const requester = await context.newPage();

  try {
    await authenticateViaDeterministicTestSession(requester, context.request, credentials.email, '');
    // Clear fixture freshness: enrollment must rely on the device approval grant.
    const pending = await context.request.post('/api/auth/reauth/start', {
      data: { purpose: 'password_change' },
      headers: { Origin: new URL(page.url()).origin },
    });

    expect(pending.ok()).toBe(true);
    await addVirtualAuthenticator(requester);
    await requester.goto('/app/en/security/device-approval');
    await requester.getByRole('button', { name: 'Create approval request' }).click();
    await expect(requester.getByRole('status').filter({ hasText: 'Waiting for approval' })).toBeVisible();
    await expect(requester.getByRole('img', { name: 'Device approval link QR code' })).toBeVisible();
    const accessibility = await new AxeBuilder({ page: requester })
      .include('[aria-labelledby="device-setup-title"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(accessibility.violations).toEqual([]);
    const shareLink = await requester
      .getByRole('link')
      .filter({ hasText: /requestId=/ })
      .getAttribute('href');

    expect(shareLink).toBeTruthy();
    expect([...new URL(shareLink!).searchParams.keys()]).toEqual(['requestId']);
    await page.goto(shareLink!);
    await page.getByRole('button', { name: 'Confirm passkey and approve', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Continue with a passkey' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Approved for passkey setup' })).toBeVisible();
    await requester.getByRole('button', { name: 'Refresh status' }).click();
    await requester.getByRole('button', { name: 'Continue passkey setup' }).click();
    await requester.getByRole('textbox', { name: 'Passkey name' }).fill('Approved laptop');
    await requester.getByRole('button', { name: 'Create passkey', exact: true }).click();
    await requester.getByRole('button', { name: 'Verify passkey', exact: true }).click();
    await expect(requester).toHaveURL(/\/app\/en\/security$/);
    await expect(requester.getByRole('heading', { name: 'Approved laptop' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('reloads a requester without persisting its code and permits cancellation', async ({ page, request }) => {
  const credentials = createCredentials();

  await authenticateViaDeterministicTestSession(page, request, credentials.email, '');
  await page.goto('/app/en/security/device-approval');
  await page.getByRole('button', { name: 'Create approval request' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Waiting for approval' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('This page was reloaded.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm passkey and approve' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel request' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Request cancelled' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start a new request' })).toBeVisible();
});
