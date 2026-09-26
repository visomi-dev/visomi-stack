import { expect, test } from '@playwright/test';

test('keeps recovery private and retries account loading without replaying verified codes', async ({ page }) => {
  let verifications = 0;
  let accountLoads = 0;

  await page.addInitScript(() =>
    Object.defineProperty(PublicKeyCredential, 'getClientCapabilities', {
      value: async () => ({ conditionalGet: false, immediateGet: false }),
    }),
  );
  for (const endpoint of ['start', 'identify', 'recovery/request']) {
    await page.route(`**/api/auth/identity/${endpoint}`, (route) =>
      route.fulfill({
        json: { data: { flowId: 'recovery-flow', google: { enabled: false } } },
      }),
    );
  }
  await page.route('**/api/auth/identity/recovery/verify', (route) => {
    verifications += 1;
    const body: unknown = route.request().postDataJSON();

    if (verifications === 1) {
      expect(body).toEqual({ flowId: 'recovery-flow', pin: '123456' });

      return route.fulfill({ status: 401, json: { code: 'recovery_unavailable' } });
    }
    expect(body).toEqual({
      flowId: 'recovery-flow',
      pin: '123456',
      factor: { kind: 'recovery_code', code: 'ABCD-EFGH-IJKL' },
    });

    return route.fulfill({ json: { data: { kind: 'restricted', authenticated: false } } });
  });
  await page.route('**/api/auth/restricted/accounts', (route) => {
    accountLoads += 1;

    return accountLoads === 1
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: {
            data: { accounts: [{ accountId: 'account-1', name: 'Private workspace', role: 'owner', selected: true }] },
          },
        });
  });
  await page.goto('/app/en/auth/sign-in');
  await page.getByRole('textbox', { name: 'Email address' }).fill('person@example.test');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Recover with email', exact: true }).click();
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('if you set up an authenticator');
  expect(accountLoads).toBe(0);
  await expect(page.getByText('Private workspace', { exact: false })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Additional verification method' }).selectOption('recovery_code');
  await page.getByRole('textbox', { name: 'Additional code (if configured)' }).fill('ABCD-EFGH-IJKL');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your email was verified');
  await expect(page.getByRole('textbox', { name: 'Verification code', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try loading accounts again' }).click();
  await expect(page.getByRole('heading', { name: 'Set a password' })).toBeVisible();
  expect(verifications).toBe(2);
  expect(accountLoads).toBe(2);
});

test.beforeEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});
test.afterEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});

test('honors the server resend deadline and gives an actionable expired-code state', async ({ page }) => {
  const now = new Date('2026-09-18T12:00:00Z');
  let resends = 0;

  await page.clock.install({ time: now });
  await page.route('**/api/auth/password/sign-in', (route) =>
    route.fulfill({
      status: 202,
      json: {
        data: {
          flowId: 'feedback-flow',
          requiredFactor: 'email',
          maskedEmail: 'p***@example.test',
          resendAvailableAt: new Date(now.getTime() + 60_000).toISOString(),
        },
      },
    }),
  );
  await page.route('**/api/auth/password/resend', (route) => {
    resends += 1;

    return route.fulfill({
      json: { data: { flowId: 'feedback-flow', resendAvailableAt: new Date(now.getTime() + 120_000).toISOString() } },
    });
  });
  await page.route('**/api/auth/password/verify', (route) =>
    route.fulfill({ status: 410, json: { code: 'challenge_expired', message: 'Internal diagnostic' } }),
  );
  await page.goto('/app/en/auth/sign-in?method=password');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill('person@example.test');
  await page.getByLabel('Password', { exact: true }).fill('twelve characters');
  await page.getByRole('button', { name: 'Sign in with password', exact: true }).click();
  await expect(page.getByRole('button', { name: /Resend code in/ })).toBeDisabled();
  expect(resends).toBe(0);
  await page.clock.fastForward(60_000);
  await page.getByRole('button', { name: 'Resend code', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('We sent a new code');
  expect(resends).toBe(1);
  await page.getByRole('textbox', { name: 'Verification code' }).fill('012345');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Start again');
  await expect(page.getByRole('alert')).not.toContainText('Internal diagnostic');
  await page.getByRole('button', { name: 'Start verification again' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in with password' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email address', exact: true })).toHaveValue('person@example.test');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
});

test('returns from a passkey failure to the full selector with keyboard focus and email intact', async ({ page }) => {
  let attempts = 0;

  await page.addInitScript(() =>
    Object.defineProperty(PublicKeyCredential, 'getClientCapabilities', {
      value: async () => ({ conditionalGet: false, immediateGet: false }),
    }),
  );
  await page.route('**/api/auth/passkey/authentication/begin', (route) => {
    attempts += 1;

    return route.fulfill({ status: 400, json: { code: 'platform_error' } });
  });
  await page.goto('/app/en/auth/sign-in');
  await page.getByRole('textbox', { name: 'Email address' }).fill('person@example.test');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with a passkey' }).click();
  await page.getByRole('button', { name: 'Use another method' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(attempts).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveValue('person@example.test');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Use password instead' }).click();
  await expect(page.getByRole('textbox', { name: 'Email address', exact: true })).toHaveValue('person@example.test');
});
