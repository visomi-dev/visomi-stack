import { expect, test } from '@playwright/test';

import { signInRoute } from '../support/routes';
import { addVirtualAuthenticator, createCredentials, registerAndAuthenticate } from '../support/auth';

test('uses native immediate UI with a saved discoverable passkey after an explicit click', async ({
  page,
  request,
}) => {
  const credentials = createCredentials();

  await registerAndAuthenticate(page, request, credentials.email, credentials.password, { immediate: true });
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('falls back to the method sheet when native immediate access does not complete', async ({ page }) => {
  await addVirtualAuthenticator(page);
  await page.addInitScript(() => {
    const capabilities = PublicKeyCredential.getClientCapabilities.bind(PublicKeyCredential);

    Object.defineProperty(PublicKeyCredential, 'getClientCapabilities', {
      value: async () => ({ ...(await capabilities()), conditionalGet: false }),
    });
    const get = navigator.credentials.get.bind(navigator.credentials);

    Object.defineProperty(navigator.credentials, 'get', {
      value: (options: CredentialRequestOptions & { uiMode?: string }) => {
        document.documentElement.dataset['passkeyMode'] = options.uiMode ?? 'modal';

        return get(options);
      },
    });
  });
  const prepared = page.waitForResponse('**/api/auth/passkey/authentication/begin');

  await page.goto(signInRoute);
  expect((await prepared).ok()).toBe(true);
  expect(await page.evaluate(async () => (await PublicKeyCredential.getClientCapabilities()).immediateGet)).toBe(true);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-passkey-mode', 'immediate');
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Create an account' })).toBeVisible();
  expect((await (await page.request.get('/api/auth/session')).json()).data.authenticated).toBe(false);
});

test('cancels conditional discovery before choosing another method', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(PublicKeyCredential, 'getClientCapabilities', {
      value: async () => ({ conditionalGet: true }),
    });
    Object.defineProperty(navigator.credentials, 'get', {
      value: (options: CredentialRequestOptions) =>
        new Promise((_resolve, reject) => {
          document.documentElement.dataset['conditionalStarted'] = String(options.mediation === 'conditional');
          options.signal?.addEventListener('abort', () => {
            document.documentElement.dataset['conditionalAborted'] = 'true';
            reject(new DOMException('Cancelled', 'AbortError'));
          });
        }),
    });
  });
  await page.goto(signInRoute);
  await expect(page.locator('html')).toHaveAttribute('data-conditional-started', 'true');
  await page.getByRole('textbox', { name: 'Email address' }).fill('returning@example.test');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-conditional-aborted', 'true');
  await page.getByRole('button', { name: 'Use password instead' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in with password' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveValue('returning@example.test');
});

test('keeps registration and password available without WebAuthn', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'PublicKeyCredential', { value: undefined }));
  await page.goto(signInRoute);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Create an account' })).toBeVisible();
  await page.getByRole('button', { name: 'Use password instead' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeEditable();
});

for (const locale of ['en', 'es']) {
  for (const width of [360, 768, 1440]) {
    for (const theme of ['light', 'dark'] as const) {
      test(`shows an accessible ${locale} method sheet at ${width}px in ${theme}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(`/app/${locale}/auth/sign-in`);
        const opener = page.getByRole('button', { name: locale === 'es' ? 'Continuar' : 'Continue', exact: true });

        await opener.click();
        const dialog = page.getByRole('dialog');

        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole('heading', { name: locale === 'es' ? 'Elige cómo continuar' : 'Choose how to continue' }),
        ).toBeVisible();
        const bounds = await dialog.boundingBox();

        expect(bounds).not.toBeNull();
        expect(bounds!.width).toBeLessThanOrEqual(width);
        if (width < 768) expect(Math.abs(bounds!.y + bounds!.height - 900)).toBeLessThan(2);
        else expect(bounds!.width).toBeLessThanOrEqual(448);
        await testInfo.attach('method-sheet', {
          body: await page.screenshot({ path: `tmp/auth-captures/method-sheet-${locale}-${width}-${theme}.png` }),
          contentType: 'image/png',
        });
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await expect(opener).toBeFocused();
      });
    }
  }
}
