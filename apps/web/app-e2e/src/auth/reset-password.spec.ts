import { expect, test } from '@playwright/test';

import { assertOpenDesignChrome } from '../support/auth-layout';
import { fillOtp } from '../support/otp';
import { forgottenPasswordRoute, resetPasswordRoute } from '../support/routes';

const TEST_API_BASE = '/api/test';
const AUTH_BASE = '/api/auth';

async function clearMailbox(request) {
  await request.delete(`${TEST_API_BASE}/mailbox`);
}

async function readLatestPin(request, email, purpose) {
  const response = await request.get(`${TEST_API_BASE}/mailbox/latest`, {
    params: { email, purpose },
  });

  expect(response.ok(), `mailbox fetch status ${response.status()}`).toBeTruthy();

  const body = await response.json();

  return body?.pin ?? null;
}

async function provisionVerifiedUser(request, email, password) {
  await clearMailbox(request);

  const signUp = await request.post(`${AUTH_BASE}/sign-up`, { data: { email, password } });

  expect(signUp.ok(), `sign-up status ${signUp.status()}`).toBeTruthy();

  const signUpBody = await signUp.json();
  const challengeId = signUpBody?.data?.challengeId;

  expect(challengeId, 'sign-up must return a challengeId').toBeTruthy();

  const pin = await readLatestPin(request, email, 'sign_up');

  if (!pin) throw new Error('no sign_up pin returned');

  const verify = await request.post(`${AUTH_BASE}/sign-up/verify`, {
    data: { challengeId, pin },
  });

  expect(verify.ok(), `sign-up verify status ${verify.status}`).toBeTruthy();
}

test.describe('/app/reset-password', () => {
  const email = 'engineer+e2e-reset-password@themis.visomi.dev';
  const password = 'S3cureAuth!';

  test.beforeAll(async ({ request }) => {
    await provisionVerifiedUser(request, email, password);
  });

  test.beforeEach(async ({ request, page }) => {
    await clearMailbox(request);

    // Drive the forgotten-password UI so the challenge is stored in
    // Auth.pendingChallenge (needed by the reset-password component).
    await page.goto(forgottenPasswordRoute);
    await page.waitForSelector('[data-slot="kicker"]');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByRole('button', { name: 'Send recovery link' }).click();
    await page.waitForURL(/\/app\/en\/reset-password$/, { timeout: 15000 });
  });

  test('renders the Open Design OTP step', async ({ page }) => {
    await page.goto(resetPasswordRoute);

    await assertOpenDesignChrome(page);
    await expect(page.locator('[data-slot="kicker"]')).toContainText('Password reset');
    await expect(page.locator('[data-slot="title"]')).toContainText('Reset your password');
    await expect(page.locator('[data-slot="sub"]')).toContainText('6-digit code');
  });

  test('reveals the password step after OTP verification', async ({ page, request }) => {
    await page.goto(resetPasswordRoute);

    const pin = await readLatestPin(request, email, 'password_reset');

    if (!pin) {
      throw new Error('expected a password_reset pin in the mailbox');
    }

    await fillOtp(page, pin);
    await page.getByRole('button', { name: 'Verify and continue' }).click();

    await expect(page.getByRole('textbox', { name: 'New password', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Confirm new password', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update password' })).toBeVisible();
  });

  test('rejects mismatched passwords', async ({ page, request }) => {
    await page.goto(resetPasswordRoute);

    const pin = await readLatestPin(request, email, 'password_reset');

    if (!pin) throw new Error('expected a password_reset pin in the mailbox');

    await fillOtp(page, pin);
    await page.getByRole('button', { name: 'Verify and continue' }).click();

    await page.getByRole('textbox', { name: 'New password', exact: true }).fill('Strong-Pass-12!');
    await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill('DifferentPass12!');

    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText("Passwords don't match.")).toBeVisible();
  });

  test('shows the success state after a valid password update', async ({ page, request }) => {
    await page.goto(resetPasswordRoute);

    const pin = await readLatestPin(request, email, 'password_reset');

    if (!pin) throw new Error('expected a password_reset pin in the mailbox');

    await fillOtp(page, pin);
    await page.getByRole('button', { name: 'Verify and continue' }).click();

    await page.getByRole('textbox', { name: 'New password', exact: true }).fill('Strong-Pass-12!');
    await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill('Strong-Pass-12!');

    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText('Password updated')).toBeVisible();
    await expect(page.getByText(/Sign in with your new password/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in to continue' })).toBeVisible();
  });
});
