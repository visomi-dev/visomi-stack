import { expect, test, signup } from './support/fixtures';

test('retries Google reauthentication after another tab invalidates the attempt', async ({ page, context }) => {
  await signup(page);

  const sessionResponse = await context.request.get('/api/auth/session');
  const session = await sessionResponse.json();
  const flowId = '33333333-3333-4333-8333-333333333333';
  const expiresAt = '2099-01-01T00:00:00Z';
  const verifications: { flowId: string; code: string }[] = [];
  const retry = page.getByRole('button', { name: 'Try Google again', exact: true });
  let attempts = 0;

  await page.route('**/api/auth/providers', (route) =>
    route.fulfill({
      json: { passkey: true, password: true, totp: true, google: { enabled: true, clientId: 'synthetic-client' } },
    }),
  );

  await page.route('**/api/auth/methods', (route) =>
    route.fulfill({ json: { passkeys: [], password: false, totp: false, google: [{ id: 'synthetic-google' }] } }),
  );

  await page.route('**/api/auth/google/start', (route) => {
    expect(route.request().postDataJSON()).toEqual({ intent: 'reauth' });

    return route.fulfill({
      status: 201,
      json: {
        flowId: '22222222-2222-4222-8222-222222222222',
        expiresAt,
        nonce: 'synthetic-nonce',
        clientId: 'synthetic-client',
      },
    });
  });

  await page.route('**/api/auth/google/complete', async (route) => {
    attempts++;

    if (attempts === 1) {
      await page.evaluate(() => {
        const channel = new BroadcastChannel('visomi-auth');

        channel.postMessage('session-changed');
        channel.close();
      });

      await retry.waitFor({ state: 'visible' });

      await route.abort();

      return;
    }

    await route.fulfill({ status: 202, json: { flowId, expiresAt, factor: 'email' } });
  });

  await page.route('**/api/auth/google/email/verify', (route) => {
    const proof = route.request().postDataJSON() as { flowId: string; code: string };

    verifications.push(proof);

    if (proof.code === '001234') {
      return route.fulfill({ status: 400, json: { error: 'verification_failed' } });
    }

    return route.fulfill({ json: { ...session, method: 'google' } });
  });

  await page.addInitScript(() => {
    let callback: (result: { credential: string }) => void;

    Object.defineProperty(window, 'google', {
      value: {
        accounts: {
          id: {
            initialize: (options: { callback: typeof callback }) => {
              callback = options.callback;
            },
            renderButton: (element: HTMLElement) => {
              const button = document.createElement('button');

              button.type = 'button';
              button.textContent = 'Synthetic Google account';
              button.onclick = () => callback({ credential: 'synthetic-id-token' });
              element.replaceChildren(button);
            },
            cancel: () => undefined,
          },
        },
      },
    });
  });

  await page.goto('/app/en/auth/reauthenticate?returnTo=%2Fsecurity%2Fpassword');

  await page.getByRole('button', { name: 'Synthetic Google account', exact: true }).click();

  await expect(retry).toBeEnabled();

  await retry.click();

  await page.getByRole('button', { name: 'Synthetic Google account', exact: true }).click();

  await expect(page.getByText('Verify your email to finish continuing with Google.', { exact: true })).toBeVisible();

  await expect(page).toHaveURL(/auth\/reauthenticate/);

  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);

  expect(verifications).toHaveLength(0);

  await page.getByLabel('Verification code', { exact: true }).fill('001234');

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('We could not verify these details.');

  await expect(page).toHaveURL(/auth\/reauthenticate/);

  await page.getByLabel('Verification code', { exact: true }).fill('005678');

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Manage password', exact: true })).toBeVisible();

  await expect(page).toHaveURL('/app/en/security/password');

  expect(verifications).toEqual([
    { flowId, code: '001234' },
    { flowId, code: '005678' },
  ]);
});
