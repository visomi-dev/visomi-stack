import { expect, test } from '@playwright/test';

import { clearMailbox } from '../support/mailbox';
import { signInRoute } from '../support/routes';

test.describe('password fallback', () => {
  test('keeps password access available on Firefox/Linux-compatible browsers', async ({ page, request }) => {
    await clearMailbox(request);
    await page.goto(signInRoute);
    await page.getByRole('button', { name: 'Use password instead' }).click();

    await expect(page.getByRole('heading', { name: 'Sign in with password' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeEditable();
    await expect(page.getByLabel('Password', { exact: true })).toBeEditable();
  });

  test('does not hide password access when Google is unavailable', async ({ page }) => {
    await page.route('**/gsi/client', (route) => route.abort());
    await page.goto(signInRoute);
    await page.getByRole('button', { name: 'Continue with Google' }).click();

    await expect(page.getByRole('alert')).toContainText('Google sign-in is not available right now.');
    await expect(page.getByRole('button', { name: 'Use password instead' })).toBeVisible();
  });
});
