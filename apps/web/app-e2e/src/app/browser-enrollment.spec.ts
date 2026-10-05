import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { addVirtualAuthenticator, createCredentials, registerAndAuthenticate } from '../support/auth';

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

test('connects isolated authenticated browsers with signed single-use delivery and cancels pending recipient custody', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120_000);
  const trusted = await registerAndAuthenticate(page, request, createCredentials().email);

  await page.goto('/app/en/security/vault');
  await page.getByLabel('Six-digit vault PIN', { exact: true }).fill('829374');
  await page.getByRole('button', { name: 'Create a new vault', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Vault PIN saved on this browser.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal recovery key', exact: true }).click();
  await confirm(page);
  const recovery = await page.locator('app-vault-settings code').innerText();
  const exported = await trusted.cdp.send('WebAuthn.getCredentials', { authenticatorId: trusted.authenticatorId });
  const credential = exported.credentials[0];
  const context = await browser.newContext({ baseURL: process.env['BASE_URL'] });

  try {
    await context.addInitScript(() => {
      Object.defineProperty(PublicKeyCredential, 'getClientCapabilities', {
        value: async () => ({ conditionalGet: false }),
      });
    });
    const receiver = await context.newPage();
    const recipientAuthenticator = await addVirtualAuthenticator(receiver);

    // The synthetic authenticator credential is cloned solely to establish a separate real session.
    // Advance fixture counters between virtual devices; production credentials are never exported.
    await recipientAuthenticator.cdp.send('WebAuthn.addCredential', {
      authenticatorId: recipientAuthenticator.authenticatorId,
      credential: { ...credential, signCount: credential.signCount + 1000 },
    });
    await receiver.goto('/app/en/auth/sign-in');
    await receiver.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect
      .poll(async () => (await (await receiver.request.get('/api/auth/session')).json()).data.authenticated)
      .toBe(true);
    await receiver.goto('/app/en/security/vault');
    await expect(receiver.getByText('Vault locked', { exact: true })).toBeVisible();
    await receiver.getByRole('button', { name: 'Request vault key from trusted browser', exact: true }).click();
    const receiverPanel = receiver.locator('app-browser-enrollment');

    await expect(receiverPanel.locator('[data-slot="request-id"]')).toBeVisible();
    const requestId = await receiverPanel.locator('[data-slot="request-id"]').innerText();
    const code = await receiverPanel.locator('[data-slot="comparison-code"]').innerText();
    const trustedPanel = page.locator('app-browser-enrollment');

    await trustedPanel.getByLabel('Browser request ID', { exact: true }).fill(requestId);
    await trustedPanel.getByLabel('Browser comparison code', { exact: true }).fill('A'.repeat(43));
    await trustedPanel.getByRole('button', { name: 'Approve browser connection', exact: true }).click();
    await expect(trustedPanel.getByRole('alert')).toContainText('Could not connect this browser.');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await trustedPanel.getByLabel('Browser comparison code', { exact: true }).fill(code);
    await trusted.cdp.send('WebAuthn.removeCredential', {
      authenticatorId: trusted.authenticatorId,
      credentialId: credential.credentialId,
    });
    await trusted.cdp.send('WebAuthn.addCredential', {
      authenticatorId: trusted.authenticatorId,
      credential: { ...credential, signCount: credential.signCount + 2000 },
    });
    const payloads: Record<string, unknown>[] = [];

    page.on('request', (request) => {
      if (request.url().endsWith('/approve') && request.url().includes('/browser-enrollments/'))
        payloads.push(request.postDataJSON() as Record<string, unknown>);
    });
    await trustedPanel.getByRole('button', { name: 'Approve browser connection', exact: true }).click();
    await confirm(page);
    await expect(trustedPanel.getByRole('status')).toContainText('Connection approved.');
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toHaveProperty('envelope.ciphertext');
    expect(JSON.stringify(payloads)).not.toContain(recovery);
    await receiver.getByRole('button', { name: 'Receive vault key', exact: true }).click();
    await expect(receiver.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
    await expect(receiverPanel.locator('[data-slot="request-id"]')).toHaveCount(0);
    const session = (await (await receiver.request.get('/api/auth/session')).json()).data;

    expect(
      (
        await receiver.request.get(`/api/vault-unlock/${session.user.accountId}/browser-enrollments/${requestId}`)
      ).status(),
    ).toBe(410);
    await recipientAuthenticator.cdp.send('WebAuthn.removeCredential', {
      authenticatorId: recipientAuthenticator.authenticatorId,
      credentialId: credential.credentialId,
    });
    await recipientAuthenticator.cdp.send('WebAuthn.addCredential', {
      authenticatorId: recipientAuthenticator.authenticatorId,
      credential: { ...credential, signCount: credential.signCount + 3000 },
    });
    await receiver.getByRole('button', { name: 'Reveal recovery key', exact: true }).click();
    await confirm(receiver);
    await expect(receiver.locator('app-vault-settings code')).toHaveText(recovery);
    const accessibility = await new AxeBuilder({ page: receiver })
      .include('app-browser-enrollment')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(accessibility.violations).toEqual([]);
    await receiver.reload();
    await expect(receiver.getByText('Vault locked', { exact: true })).toBeVisible();
    await receiver.getByRole('button', { name: 'Request vault key from trusted browser', exact: true }).click();
    await expect(receiverPanel.locator('[data-slot="request-id"]')).toBeVisible();
    const cancelledId = await receiverPanel.locator('[data-slot="request-id"]').innerText();
    const cancelled = receiver.waitForResponse(
      (response) =>
        response.url().endsWith(`/browser-enrollments/${cancelledId}`) && response.request().method() === 'DELETE',
    );

    await receiver.getByRole('button', { name: 'Cancel browser request', exact: true }).click();
    expect((await cancelled).status()).toBe(204);
    await expect(receiverPanel.locator('[data-slot="request-id"]')).toHaveCount(0);
    expect(
      (
        await receiver.request.get(`/api/vault-unlock/${session.user.accountId}/browser-enrollments/${cancelledId}`)
      ).status(),
    ).toBe(410);
    await receiver.goto('/app/es/security/vault');
    await expect(receiver.getByRole('heading', { name: 'Conectar otro navegador', exact: true })).toBeVisible();
  } finally {
    await context.close().catch(() => undefined);
  }
});
