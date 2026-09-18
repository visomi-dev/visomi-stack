import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { addVirtualAuthenticator } from '../support/auth';

test('abandons the password verification screen on browser Back without showing reset-field errors', async ({
  page,
}) => {
  await page.route('**/api/auth/password/sign-in', (route) =>
    route.fulfill({
      status: 202,
      json: { data: { flowId: 'navigation-flow', requiredFactor: 'email', maskedEmail: 'p***@example.test' } },
    }),
  );
  await page.goto('/app/en/auth/sign-in');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Use password instead' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in with password', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill('person@example.test');
  await page.getByLabel('Password', { exact: true }).fill('twelve chars');
  await page.getByRole('button', { name: 'Sign in with password', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Enter your password' })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Sign in with password' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toHaveCount(0);
});

test('prevents another passkey signup session from sending email during the destination cooldown', async ({
  page,
  browser,
}) => {
  const email = `signup-limit-${randomUUID()}@example.test`;

  await addVirtualAuthenticator(page);
  await page.goto('/app/en/auth/sign-up');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(email);
  await page.getByRole('button', { name: 'Create account with passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const mailboxUrl = `/api/test/mailbox/latest?email=${encodeURIComponent(email)}&purpose=bootstrap_recovery`;
  const original = await (await page.request.get(mailboxUrl)).json();
  const secondContext = await browser.newContext({ baseURL: new URL(page.url()).origin });

  try {
    const secondPage = await secondContext.newPage();

    await addVirtualAuthenticator(secondPage);
    await secondPage.goto('/app/en/auth/sign-up');
    await secondPage.getByRole('textbox', { name: 'Email address', exact: true }).fill(email);
    const response = secondPage.waitForResponse('**/api/auth/passkey/sign-up/complete');

    await secondPage.getByRole('button', { name: 'Create account with passkey' }).click();
    const limited = await response;

    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0);
    await expect(secondPage.getByRole('alert').filter({ hasText: 'retry after the cooldown' })).toBeVisible();
    expect((await (await page.request.get(mailboxUrl)).json()).challengeId).toBe(original.challengeId);
  } finally {
    await secondContext.close();
  }
});
