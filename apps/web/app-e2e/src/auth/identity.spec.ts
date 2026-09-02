import { expect, test } from '@playwright/test';

import {
  addVirtualAuthenticator,
  authenticateViaDeterministicTestSession,
  createCredentials,
  registerAndAuthenticate,
} from '../support/auth';
import { assertOpenDesignChrome } from '../support/auth-layout';
import { activationUrlPattern, appUrlPattern, identityRoute, identityUrlPattern } from '../support/routes';

test.describe('/app/auth/identity', () => {
  test('renders the unified passkey-first access route', async ({ page }) => {
    await page.goto(identityRoute);

    await assertOpenDesignChrome(page);
    await expect(page.getByRole('heading', { name: 'Sign in or create an account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with a passkey' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try another way' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Email address' })).toBeHidden();
  });

  test('opens email bootstrap inline without changing routes', async ({ page }) => {
    await page.goto(identityRoute);
    await page.getByRole('button', { name: 'Try another way' }).click();

    await expect(page).toHaveURL(identityUrlPattern);
    await expect(page.getByRole('textbox', { name: 'Email address' })).toBeEditable();
  });

  test('offers passkey retry before retaining email recovery', async ({ page }) => {
    const retryRequests: boolean[] = [];

    await page.route('**/api/auth/passkey/authentication/begin', async (route) => {
      const body = route.request().postDataJSON() as { retryRequested: boolean };

      retryRequests.push(body.retryRequested);
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'platform_error', message: 'Passkey authentication failed.' }),
      });
    });
    await page.goto(identityRoute);
    await page.getByRole('button', { name: 'Continue with a passkey' }).click();

    await expect(page.getByRole('heading', { name: 'Passkey sign-in did not finish.' })).toBeVisible();
    await page.getByRole('button', { name: 'Try passkey again' }).click();
    await expect.poll(() => retryRequests).toEqual([false, true]);
    await expect(page.getByRole('button', { name: 'Try another way' })).toBeVisible();
  });

  test('bootstraps a new account only after OTP and passkey verification', async ({ page, request }) => {
    const credentials = createCredentials();

    await registerAndAuthenticate(page, request, credentials.email, credentials.password, {
      completeActivation: false,
    });

    await expect(page).toHaveURL(activationUrlPattern);
    const session = await page.request.get('/api/auth/session');
    const payload = (await session.json()) as { data: { kind: string; user: { email: string } | null } };

    expect(payload.data).toMatchObject({ kind: 'full', user: { email: credentials.email } });

    await page.goto('/app/en/security');
    await page.getByRole('button', { name: 'Add passkey' }).click();
    await page.getByRole('textbox', { name: 'Passkey name' }).fill('Backup security key');
    await page.route('**/api/auth/passkey/registration/begin', async (route) => {
      await addVirtualAuthenticator(page, 'usb');
      await route.continue();
    });
    await page.getByRole('button', { name: 'Confirm and add passkey' }).click();

    await expect(page.getByRole('heading', { name: 'Backup security key' })).toBeVisible();
  });

  test('redirects authenticated users away from /auth/identity', async ({ page, request }) => {
    const credentials = createCredentials();

    await authenticateViaDeterministicTestSession(page, request, credentials.email, credentials.password);
    await page.goto(identityRoute);

    await expect(page).toHaveURL(appUrlPattern);
  });
});
