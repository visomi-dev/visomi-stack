import { expect, test } from '@playwright/test';

import { readLatestPin } from '../support/mailbox';
import { createCredentials, signIn, signOutViaApi, signUp, verifyLatestCode } from '../support/auth';
import { fillOtp } from '../support/otp';
import { appUrlPattern, signInUrlPattern, verifyEmailRoute, verifyEmailUrlPattern } from '../support/routes';

test.describe('/app/verify-email', () => {
  test('redirects to sign-in when no challenge is active', async ({ page }) => {
    await page.goto(verifyEmailRoute);

    await expect(page).toHaveURL(signInUrlPattern);
  });

  test('shows an inline error for an invalid verification code', async ({ page }) => {
    const credentials = createCredentials();

    await signUp(page, credentials.email, credentials.password);
    await fillOtp(page, '000000');
    await page.getByRole('button', { name: 'Verify and continue' }).click();

    await expect(page).toHaveURL(verifyEmailUrlPattern);
    // `getByRole('alert')` matches both the top-level `<app-alert>` banner and
    // the inline `<p role="alert">` from `<app-error-message>`. The inline one
    // is the per-field error and is the contract we care about for the CSS-
    // driven reveal pattern. Asserting on its id is unambiguous.
    await expect(page.locator('#verification-pin-error')).toContainText('The code didn');
  });

  test('shows cooldown feedback when resend is requested too early', async ({ page, request }) => {
    const credentials = createCredentials();

    await signUp(page, credentials.email, credentials.password);
    const originalPin = await readLatestPin(request, credentials.email, 'sign_up');

    await page.getByRole('button', { name: 'Resend code' }).click();

    await expect(page).toHaveURL(verifyEmailUrlPattern);

    const nextPin = await readLatestPin(request, credentials.email, 'sign_up');

    expect(nextPin).toBe(originalPin);
  });

  test('completes sign-in verification with the latest code', async ({ page, request }) => {
    const credentials = createCredentials();

    await signUp(page, credentials.email, credentials.password);
    const signUpPin = await readLatestPin(request, credentials.email, 'sign_up');

    await fillOtp(page, signUpPin);
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await signOutViaApi(page);

    await signIn(page, credentials.email, credentials.password);

    await verifyLatestCode(page, request, credentials.email, 'sign_in');

    await expect(page).toHaveURL(appUrlPattern);
    await expect(page.getByRole('heading', { name: 'dashboard works!' })).toBeVisible();
  });
});
