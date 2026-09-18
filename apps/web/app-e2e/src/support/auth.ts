import { randomUUID } from 'node:crypto';

import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { clearMailbox, readLatestPin } from './mailbox';
import { fillOtp } from './otp';
import { activationUrlPattern, signInRoute, signInUrlPattern } from './routes';

type VerificationOptions = {
  completeActivation?: boolean;
  immediate?: boolean;
};

export const createCredentials = () => ({
  email: `engineer+e2e-${randomUUID()}@visomi-stack.test`,
  password: '',
});

const waitForAuthenticatedSession = async (page: Page, email: string) => {
  await expect
    .poll(
      async () => {
        return page.evaluate(async () => {
          const response = await fetch('/api/auth/session', {
            credentials: 'include',
          });

          if (!response.ok) {
            return null;
          }

          const payload = (await response.json()) as {
            data: {
              user: { accountId?: string; email?: string } | null;
            };
          };

          return payload.data?.user?.email && payload.data?.user?.accountId
            ? { accountId: payload.data.user.accountId, email: payload.data.user.email }
            : null;
        });
      },
      { timeout: 15000 },
    )
    .toEqual({
      accountId: expect.any(String),
      email,
    });
};

const completeActivationIfNeeded = async (page: Page) => {
  if (!activationUrlPattern.test(page.url())) {
    return;
  }

  await page.getByRole('button', { name: /Skip for now/i }).click();
  await expect(page).toHaveURL(/\/app\/en\/dashboard$/, { timeout: 15000 });
};

export const authenticateViaApi = async (page: Page, request: APIRequestContext, email: string, _password: string) => {
  await clearMailbox(request);

  await page.goto(signInRoute);
  await expect(page).toHaveURL(signInUrlPattern);
  await page.getByRole('button', { name: 'Try another way' }).click();

  const emailField = page.locator('#identity-email');

  await emailField.fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();

  await expect(page.getByRole('heading', { name: 'Check for a 6-digit code' })).toBeVisible();

  const pin = await readLatestPin(request, email, 'bootstrap_recovery');

  await fillOtp(page, pin);
  await page.getByRole('button', { name: 'Verify email' }).click();

  await expect(page.getByRole('heading', { name: 'Create a passkey to finish.' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Passkey name' }).fill('Laptop');
  await page.getByRole('button', { name: 'Create passkey' }).click();

  await waitForAuthenticatedSession(page, email);
  await completeActivationIfNeeded(page);
};

export const authenticateViaDeterministicTestSession = async (
  page: Page,
  request: APIRequestContext,
  email: string,
  _password: string,
) => {
  await page.goto(signInRoute);
  await expect(page).toHaveURL(signInUrlPattern);
  const response = await request.post('/api/test/auth/session', { data: { email } });

  if (!response.ok()) throw new Error(`deterministic test session failed with ${response.status()}`);

  const cookies = response
    .headers()
    ['set-cookie'].split(/, (?=[^;]+=)/)
    .map((cookie) => cookie.split(';', 1)[0].split('='))
    .map(([name, ...value]) => ({ name, value: value.join('='), url: new URL(page.url()).origin }));

  await page
    .context()
    .addCookies([...cookies, { name: 'themis.hasSession', value: '1', url: new URL(page.url()).origin }]);
  await waitForAuthenticatedSession(page, email);

  const activationStatus = await page.evaluate(async () => {
    const response = await fetch('/api/activation/milestones', {
      body: JSON.stringify({ milestone: 'activation_completed' }),
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    return response.status;
  });

  if (activationStatus !== 204 && activationStatus !== 409) {
    throw new Error(`deterministic activation completion failed with ${activationStatus}`);
  }
};

export const signIn = async (page: Page, _email: string, _password: string) => {
  await page.goto(signInRoute);
  await expect(page).toHaveURL(signInUrlPattern);
  await expect(page.getByRole('heading', { name: 'Sign in or create an account' })).toBeVisible();
};

export const verifyLatestCode = async (
  page: Page,
  request: APIRequestContext,
  email: string,
  options: VerificationOptions = {},
) => {
  await page.goto(signInRoute);
  await page.getByRole('button', { name: 'Try another way' }).click();

  await page.locator('#identity-email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();

  await expect(page.getByRole('heading', { name: 'Check for a 6-digit code' })).toBeVisible();

  const pin = await readLatestPin(request, email, 'bootstrap_recovery');

  await fillOtp(page, pin);
  await page.getByRole('button', { name: 'Verify email' }).click();

  await expect(page.getByRole('heading', { name: 'Create a passkey to finish.' })).toBeVisible();

  if (options.completeActivation ?? true) {
    await completeActivationIfNeeded(page);
  }
};

export const registerAndAuthenticate = async (
  page: Page,
  request: APIRequestContext,
  email: string,
  password: string,
  options: VerificationOptions = {},
) => {
  void password;
  await page.addInitScript((immediate) => {
    const capabilities = PublicKeyCredential.getClientCapabilities.bind(PublicKeyCredential);

    Object.defineProperty(PublicKeyCredential, 'getClientCapabilities', {
      value: async () => ({ ...(immediate ? await capabilities() : {}), conditionalGet: false }),
    });
    const get = navigator.credentials.get.bind(navigator.credentials);

    Object.defineProperty(navigator.credentials, 'get', {
      value: (request: CredentialRequestOptions & { uiMode?: string }) => {
        document.documentElement.dataset['passkeyMode'] = request.uiMode ?? 'modal';

        return get(request);
      },
    });
  }, options.immediate ?? false);
  await addVirtualAuthenticator(page);
  await page.goto('/app/en/auth/sign-up');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(email);
  await page.getByRole('button', { name: 'Create account with passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Verification code' })
    .fill(await readLatestPin(request, email, 'bootstrap_recovery'));
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your account is verified' })).toBeVisible();
  // A saved credential must work even after the browser's anonymous/signup session has disappeared.
  await page.context().clearCookies();
  const prepared = options.immediate ? page.waitForResponse('**/api/auth/passkey/authentication/begin') : null;

  await page.getByRole('link', { name: 'Continue to sign in' }).click();
  if (prepared) {
    const response = await prepared;

    expect(response.ok()).toBe(true);
    expect(await page.evaluate(async () => (await PublicKeyCredential.getClientCapabilities()).immediateGet)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  if (options.immediate) await expect(page.locator('html')).toHaveAttribute('data-passkey-mode', 'immediate');
  else await page.getByRole('button', { name: 'Continue with a passkey' }).click();
  await waitForAuthenticatedSession(page, email);
  await expect(page).toHaveURL(activationUrlPattern);
  if (options.completeActivation ?? true) await completeActivationIfNeeded(page);
};

export const addVirtualAuthenticator = async (page: Page, transport: 'internal' | 'usb' = 'internal') => {
  const cdp = await page.context().newCDPSession(page);

  await cdp.send('WebAuthn.enable');

  return cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
};

export const signOutViaApi = async (page: Page) => {
  await page.evaluate(async () => {
    await fetch('/api/auth/sign-out', {
      credentials: 'include',
      method: 'POST',
    });
  });
};

export const signOutViaMenu = async (page: Page) => {
  await page.locator('[data-od-id="sidebar-sign-out"]').click();
};

export const registerAndSignOut = async (page: Page, request: APIRequestContext, email: string, password: string) => {
  await registerAndAuthenticate(page, request, email, password);
  await signOutViaApi(page);
  await page.goto(signInRoute);
  await expect(page).toHaveURL(signInUrlPattern);
};
