import { expect, test } from '@playwright/test';

import { createCredentials, signUp } from '../support/auth';
import { assertOpenDesignChrome } from '../support/auth-layout';
import { signUpRoute, verifyEmailUrlPattern } from '../support/routes';

test.describe('/app/sign-up', () => {
  test('renders the Open Design auth shell and copy', async ({ page }) => {
    await page.goto(signUpRoute);

    await assertOpenDesignChrome(page);
    await expect(page.locator('[data-slot="kicker"]')).toContainText('New account');
    await expect(page.locator('[data-slot="title"]')).toContainText('Create your account');
    await expect(page.locator('[data-slot="sub"]')).toContainText('passkey');
  });

  test('shows validation errors for invalid credentials', async ({ page }) => {
    await page.goto(signUpRoute);
    await page.getByRole('button', { name: 'Use password instead' }).click();
    await page.locator('[data-slot="submit"]').click();

    await expect(page.getByText('Enter your email address.')).toBeVisible();
    await expect(page.getByText('Choose a password.')).toBeVisible();
    await expect(page.getByText('Re-enter your new password.')).toBeVisible();
  });

  test('moves into verification after a valid submission', async ({ page }) => {
    const credentials = createCredentials();

    await signUp(page, credentials.email, credentials.password);

    await expect(page).toHaveURL(verifyEmailUrlPattern);
  });
});
