import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { expect, test } from '@playwright/test';

import { readLatestPin } from '../support/mailbox';

for (const [description, password] of [
  ['astral characters', '😀'.repeat(128)],
  ['decomposed characters', 'e\u0301'.repeat(128)],
]) {
  test(`accepts 128 normalized code points without native truncation (${description})`, async ({ page }) => {
    await page.goto('/app/en/auth/sign-up?method=password');
    await page
      .getByRole('textbox', { name: 'Email address', exact: true })
      .fill(`unicode-${randomUUID()}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue(password);
    await expect(page.getByText('Length requirement met (12–128 characters).')).toBeVisible();
    const response = page.waitForResponse('**/api/auth/password/sign-up');

    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    expect((await response).status()).toBe(202);
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  });
}

test('keeps email validation collapsed while typing and centers its icon after blur', async ({ page }) => {
  await page.goto('/app/en/auth/sign-up?method=password');
  const email = page.getByRole('textbox', { name: 'Email address', exact: true });
  const password = page.getByLabel('Password', { exact: true });
  const error = page.locator('#sign-up-email-error');

  await email.focus();
  const initial = await password.boundingBox();

  for (const value of ['a', 'ab', 'ab@', 'ab@example.com', 'ab@']) {
    await email.fill(value);
    await expect.poll(async () => (await error.locator('..').boundingBox())?.height ?? 0).toBe(0);
    expect((await password.boundingBox())?.y).toBe(initial?.y);
  }
  await email.blur();
  await expect.poll(async () => (await error.locator('..').boundingBox())?.height ?? 0).toBeGreaterThan(0);
  const icon = await error.locator('app-icon').boundingBox();
  const text = await error.locator('span').last().boundingBox();

  expect(icon).not.toBeNull();
  expect(text).not.toBeNull();
  expect(Math.abs(icon!.y + icon!.height / 2 - text!.y - text!.height / 2)).toBeLessThan(2);
  await page.screenshot({ path: 'tmp/auth-captures/email-error-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'tmp/auth-captures/email-error-mobile.png', fullPage: true });
  await email.focus();
  await expect.poll(async () => (await error.locator('..').boundingBox())?.height ?? 0).toBe(0);
  const focusedPosition = await password.boundingBox();

  await email.fill('correct@example.test');
  expect((await password.boundingBox())?.y).toBe(focusedPosition?.y);
});

test('uses query parameters for password navigation and survives reload and browser back', async ({ page }) => {
  await page.goto('/app/en/auth/sign-in');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Use password instead' }).click();
  await expect(page).toHaveURL(/method=password/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in with password' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
});

test('creates a password account with 12 characters and completes email and password sign-in', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const email = `password-${randomUUID()}@example.test`;
  const password = 'twelve chars';

  await page.goto('/app/en/auth/sign-up');
  await page.getByRole('link', { name: 'Use password instead' }).click();
  await expect(page).toHaveURL(/method=password/);
  await expect(page.getByRole('heading', { name: 'Create your account', exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeEditable();
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(email);
  await expect(page.getByRole('textbox', { name: 'Email address', exact: true })).toHaveValue(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await expect(page.getByRole('textbox', { name: 'Email address', exact: true })).toHaveValue(email);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await expect(page.getByText('Length requirement met (12–128 characters).')).toBeVisible();
  await page.screenshot({ path: 'tmp/auth-captures/password-indicator.png', fullPage: true });
  const signupResponse = page.waitForResponse('**/api/auth/password/sign-up');

  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  const signup = await signupResponse;

  expect(signup.status()).toBe(202);
  const delivery = (await signup.json()) as { data: { resendAvailableAt: string } };
  const resendAvailableAt = Date.parse(delivery.data.resendAvailableAt);

  expect(Number.isFinite(resendAvailableAt)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Verification code' })
    .fill(await readLatestPin(request, email, 'password_signup'));
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get('/api/auth/session')).json()).data.authenticated)
    .toBe(true);
  // Signup and sign-in share the destination delivery cooldown on the real server.
  await delay(Math.max(0, resendAvailableAt - Date.now()));
  await page.context().clearCookies();
  await page.goto('/app/en/auth/sign-in?method=password');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in with password', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page
    .getByRole('textbox', { name: /Verification code/i })
    .fill(await readLatestPin(request, email, 'password_second_step'));
  await page.getByRole('button', { name: /Verify and sign in/i }).click();
  await expect
    .poll(async () => (await (await page.request.get('/api/auth/session')).json()).data.authenticated)
    .toBe(true);
});

for (const expiredAssertion of [false, true]) {
  test(`creates the passkey before email verification and signs in with fresh cookies (expired assertion: ${expiredAssertion})`, async ({
    page,
    request,
  }) => {
    const cdp = await page.context().newCDPSession(page);

    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    const email = `passkey-${randomUUID()}@example.test`;

    await page.goto('/app/en/auth/sign-up');
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(email);
    await page.getByRole('button', { name: 'Create account with passkey' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    expect((await (await page.request.get('/api/auth/session')).json()).data.authenticated).toBe(false);
    const otherSession = await request.post('/api/auth/passkey/sign-up/verify', {
      data: { code: '123456' },
      headers: { Origin: new URL(page.url()).origin },
    });

    expect(otherSession.status()).toBe(410);
    const pin = await readLatestPin(request, email, 'bootstrap_recovery');

    await page.getByRole('textbox', { name: 'Verification code' }).fill(pin === '000000' ? '111111' : '000000');
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'The verification code is invalid.' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Verification code' }).fill(pin);
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    await expect
      .poll(async () => (await (await page.request.get('/api/auth/session')).json()).data.authenticated)
      .toBe(true);
    const replay = await page.request.post('/api/auth/passkey/sign-up/verify', {
      data: { code: pin },
      headers: { Origin: new URL(page.url()).origin },
    });

    expect(replay.status()).toBe(410);
    await page.context().clearCookies();
    await page.goto('/app/en/auth/sign-in');
    if (expiredAssertion) {
      await page.route(
        '**/api/auth/passkey/authentication/complete',
        (route) =>
          route.fulfill({
            status: 410,
            json: { code: 'challenge_expired', message: 'The challenge has expired.' },
          }),
        { times: 1 },
      );
    }
    if (expiredAssertion) {
      await expect(page.getByRole('heading', { name: 'Passkey sign-in did not finish.' })).toBeVisible();
      expect((await (await page.request.get('/api/auth/session')).json()).data.authenticated).toBe(false);
      await page.getByRole('button', { name: 'Try passkey again' }).click();
    }
    await expect
      .poll(async () => (await (await page.request.get('/api/auth/session')).json()).data.authenticated)
      .toBe(true);
  });
}
