import { expect, test, type Page } from '@playwright/test';

import { assertOpenDesignChrome } from '../support/auth-layout';
import { forgottenPasswordRoute, signInUrlPattern } from '../support/routes';

test.describe('/app/forgotten-password', () => {
  async function fillEmail(page: Page, email: string) {
    const emailField = page.locator('#forgotten-password-email');

    await expect(emailField).toBeVisible();
    await expect(emailField).toBeEditable();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await emailField.fill(email);

      try {
        await expect(emailField).toHaveValue(email, { timeout: 2_000 });

        return;
      } catch (error) {
        if (attempt === 2) {
          throw error;
        }
      }
    }
  }

  test('renders the Open Design auth shell and copy', async ({ page }) => {
    await page.goto(forgottenPasswordRoute);

    await assertOpenDesignChrome(page);
    await expect(page.locator('[data-slot="kicker"]')).toContainText('Account recovery');
    await expect(page.locator('[data-slot="title"]')).toContainText('Recover password');
    await expect(page.locator('[data-slot="sub"]')).toContainText('recovery link');
  });

  test('shows validation errors when submitting empty form', async ({ page }) => {
    await page.goto(forgottenPasswordRoute);
    await page.getByRole('button', { name: 'Send recovery link' }).click();

    await expect(page.getByText('Enter your email address.')).toBeVisible();
  });

  test('shows validation error for invalid email format', async ({ page }) => {
    await page.goto(forgottenPasswordRoute);
    const emailField = page.getByRole('textbox', { name: 'Email' });

    await expect(page.locator('[data-slot="title"]')).toContainText('Recover password');
    await expect(emailField).toBeEditable();

    await fillEmail(page, 'not-an-email');
    await page.getByRole('button', { name: 'Send recovery link' }).click();

    await expect(page.getByText(/Enter (a valid|your) email address/)).toBeVisible();
  });

  test('shows success card after valid submission', async ({ page }) => {
    await page.goto(forgottenPasswordRoute);
    const emailField = page.getByRole('textbox', { name: 'Email' });

    await expect(emailField).toBeEditable();

    await fillEmail(page, 'engineer+recovery@themis.visomi.dev');
    await page.getByRole('button', { name: 'Send recovery link' }).click();

    await expect(page.getByText('Recovery link sent')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/engineer\+recovery@themis\.visomi\.dev/)).toBeVisible();
  });

  test('back to sign in link navigates to sign-in', async ({ page }) => {
    await page.goto(forgottenPasswordRoute);
    await page.getByRole('link', { name: 'Back to sign in' }).click();

    await expect(page).toHaveURL(signInUrlPattern);
  });
});
