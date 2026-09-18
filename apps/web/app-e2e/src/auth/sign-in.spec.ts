import { expect, test } from '@playwright/test';

import {
  addVirtualAuthenticator,
  authenticateViaDeterministicTestSession,
  createCredentials,
  registerAndAuthenticate,
} from '../support/auth';
import { assertOpenDesignChrome } from '../support/auth-layout';
import { activationUrlPattern, appUrlPattern, signInRoute, signInUrlPattern } from '../support/routes';

test.describe('/app/auth/sign-in', () => {
  test('renders the unified passkey-first access route', async ({ page }) => {
    await page.goto(signInRoute);

    await assertOpenDesignChrome(page);
    await expect(page.getByRole('heading', { name: 'Sign in to Visomi Stack' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Email address' })).toBeEditable();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Continue with a passkey' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recover with email' })).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('opens email recovery inline without changing routes', async ({ page }) => {
    await page.goto(signInRoute);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Recover with email' }).click();

    await expect(page).toHaveURL(signInUrlPattern);
    await expect(page.getByRole('textbox', { name: 'Email address' })).toBeEditable();
  });

  test('offers passkey retry before retaining email recovery', async ({ page }) => {
    const retryRequests: boolean[] = [];

    await page.addInitScript(() => {
      Object.defineProperty(PublicKeyCredential, 'getClientCapabilities', {
        value: async () => ({ conditionalGet: false }),
      });
    });

    await page.route('**/api/auth/passkey/authentication/begin', async (route) => {
      const body = route.request().postDataJSON() as { retryRequested: boolean };

      retryRequests.push(body.retryRequested);
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'platform_error', message: 'Passkey authentication failed.' }),
      });
    });
    await page.goto(signInRoute);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Continue with a passkey' }).click();

    await expect(page.getByRole('heading', { name: 'Passkey sign-in did not finish.' })).toBeVisible();
    await page.getByRole('button', { name: 'Try passkey again' }).click();
    await expect.poll(() => retryRequests).toEqual([false, true]);
    await expect(page.getByRole('button', { name: 'Recover with email' })).toBeVisible();
  });

  test('creates a passkey account after email verification and can add another passkey', async ({ page, request }) => {
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

  test('redirects authenticated users away from /auth/sign-in', async ({ page, request }) => {
    const credentials = createCredentials();

    await authenticateViaDeterministicTestSession(page, request, credentials.email, credentials.password);
    await page.goto(signInRoute);

    await expect(page).toHaveURL(appUrlPattern);
  });
});
