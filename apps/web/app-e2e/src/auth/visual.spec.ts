import { expect, test, type Page } from '@playwright/test';

import { authenticateViaApi, createCredentials, signOutViaApi, signUp } from '../support/auth';
import { clearMailbox } from '../support/mailbox';
import { fillOtp } from '../support/otp';
import {
  forgottenPasswordRoute,
  resetPasswordRoute,
  signInRoute,
  signUpRoute,
  verifyEmailUrlPattern,
} from '../support/routes';

type Theme = 'light' | 'dark';

const themes: readonly Theme[] = ['light', 'dark'];

async function setTheme(page: Page, theme: Theme): Promise<void> {
  const html = page.locator('html');
  const isDark = await html.evaluate((element) => element.classList.contains('dark'));

  if ((theme === 'dark') !== isDark) {
    await page.getByRole('button', { name: 'Toggle light/dark theme' }).click();
  }

  await expect(html).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
}

async function prepareVerifyEmail(page: Page): Promise<void> {
  await signUp(page, createCredentials().email, 'S3cureAuth!');
  await expect(page).toHaveURL(verifyEmailUrlPattern);
}

async function prepareResetPassword(page: Page, request: Parameters<typeof clearMailbox>[0]): Promise<void> {
  const credentials = createCredentials();

  // The recovery flow only issues a challenge for an existing verified user.
  // Provision that user in this isolated browser context before opening the UI.
  await authenticateViaApi(page, request, credentials.email, credentials.password);
  await signOutViaApi(page);
  await clearMailbox(request);
  await page.goto(forgottenPasswordRoute);
  await page.getByRole('textbox', { name: 'Email' }).fill(credentials.email);
  await page.getByRole('button', { name: 'Send recovery link' }).click();
  await page.waitForURL(resetPasswordRoute);
}

for (const theme of themes) {
  test(`sign-in visual regression (${theme})`, async ({ page }) => {
    await page.goto(signInRoute);
    await setTheme(page, theme);

    await expect(page).toHaveScreenshot(`sign-in-${theme}.png`, { fullPage: true });
  });

  test(`sign-up visual regression (${theme})`, async ({ page }) => {
    await page.goto(signUpRoute);
    await setTheme(page, theme);

    await expect(page).toHaveScreenshot(`sign-up-${theme}.png`, { fullPage: true });
  });

  test(`verify-email visual regression (${theme})`, async ({ page }) => {
    await prepareVerifyEmail(page);
    await setTheme(page, theme);

    await expect(page).toHaveScreenshot(`verify-email-${theme}.png`, { fullPage: true });
  });

  test(`forgotten-password visual regression (${theme})`, async ({ page }) => {
    await page.goto(forgottenPasswordRoute);
    await setTheme(page, theme);

    await expect(page).toHaveScreenshot(`forgotten-password-${theme}.png`, { fullPage: true });
  });

  test(`reset-password visual regression (${theme})`, async ({ page, request }) => {
    await prepareResetPassword(page, request);
    await setTheme(page, theme);

    await expect(page).toHaveScreenshot(`reset-password-${theme}.png`, { fullPage: true });
  });
}

test('verify-email validation visual regression', async ({ page }) => {
  await prepareVerifyEmail(page);
  await fillOtp(page, '000000');
  await page.getByRole('button', { name: 'Verify and continue' }).click();

  await expect(page).toHaveScreenshot('verify-email-invalid-code.png', { fullPage: true });
});

for (const theme of themes) {
  test(`passkey retry and explicit fallback states (${theme})`, async ({ page }) => {
    await page.route('**/api/auth/passkey/authentication/begin', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'pin_required',
          message: 'Complete email PIN verification before using a passkey.',
        }),
      });
    });
    await page.goto(signInRoute);
    await setTheme(page, theme);
    await page.locator('#passkey-sign-in-email').fill('person@example.com');
    await page.getByRole('button', { name: 'Continue with passkey' }).click();
    await expect(page.getByText('Verify your email first.')).toBeVisible();
    await expect(page).toHaveScreenshot(`sign-in-passkey-verification-${theme}.png`, { fullPage: true });
    await page.getByRole('button', { name: 'Use password instead' }).click();
    await expect(page.locator('#sign-in-password')).toBeVisible();
    await expect(page).toHaveScreenshot(`sign-in-passkey-fallback-${theme}.png`, { fullPage: true });
  });
}
