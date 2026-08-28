import { expect, test } from '@playwright/test';

import {
  createCredentials,
  registerAndAuthenticate,
  registerAndSignOut,
  signIn,
  signInWithRememberedDevice,
  signOutViaApi,
  verifyLatestCode,
} from '../support/auth';
import { assertOpenDesignChrome } from '../support/auth-layout';
import { appUrlPattern, signInRoute, signInUrlPattern } from '../support/routes';

test.describe('/app/sign-in', () => {
  test('renders the Open Design auth shell and copy', async ({ page }) => {
    await page.goto(signInRoute);

    await assertOpenDesignChrome(page);
    await expect(page.locator('[data-slot="kicker"]')).toContainText('Account access');
    await expect(page.locator('[data-slot="title"]')).toContainText('Sign in');
    await expect(page.locator('[data-slot="sub"]')).toContainText('Welcome back.');
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeHidden();
  });

  test('reveals password controls only after an explicit choice', async ({ page }) => {
    await page.goto(signInRoute);

    await expect(page.getByRole('textbox', { name: 'Password' })).toBeHidden();
    await page.getByRole('button', { name: 'Use password instead' }).click();

    const rememberDevice = page.getByRole('checkbox', { name: 'Remember this device' });
    const rememberLabel = page.locator('label').filter({ hasText: 'Remember this device' });

    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Forgotten password?' })).toBeVisible();
    await expect(rememberDevice).not.toBeChecked();
    await rememberLabel.click();
    await expect(rememberDevice).toBeChecked();

    await rememberLabel.click();
    await expect(rememberDevice).not.toBeChecked();
  });

  test('signs an existing user in through email verification', async ({ page, request }) => {
    const credentials = createCredentials();

    await registerAndSignOut(page, request, credentials.email, credentials.password);
    await signIn(page, credentials.email, credentials.password);
    await verifyLatestCode(page, request, credentials.email, 'sign_in');

    await expect(page).toHaveURL(appUrlPattern);
    await expect(page.getByRole('heading', { name: 'dashboard works!' })).toBeVisible();

    await signOutViaApi(page);
    await signInWithRememberedDevice(page, credentials.email, credentials.password);

    await expect(page.getByRole('heading', { name: 'dashboard works!' })).toBeVisible();
  });

  test('stays on the route when credentials are invalid', async ({ page }) => {
    await page.goto(signInRoute);
    await page.getByRole('button', { name: 'Use password instead' }).click();
    const emailField = page.getByRole('textbox', { name: 'Email', exact: true });

    const passwordField = page.getByRole('textbox', { name: 'Password' });

    await expect(page).toHaveURL(signInUrlPattern);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(emailField).toBeEditable();
    await expect(passwordField).toBeEditable();

    await emailField.fill('bad-email');
    await expect(emailField).toHaveValue('bad-email');
    await passwordField.fill('short');
    await expect(passwordField).toHaveValue('short');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(signInUrlPattern);
    await expect(page.getByText(/Enter (a valid|your) email address/)).toBeVisible();
    await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
  });

  test('redirects authenticated users away from sign-in', async ({ page, request }) => {
    const credentials = createCredentials();

    await registerAndAuthenticate(page, request, credentials.email, credentials.password);
    await page.goto(signInRoute);

    await expect(page).toHaveURL(appUrlPattern);
    await expect(page.getByText('dashboard works!')).toBeVisible();
  });
});
