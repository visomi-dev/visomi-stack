import { randomUUID } from 'node:crypto';

import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { clearMailbox, readLatestPin } from './mailbox';
import { fillOtp } from './otp';
import {
  appUrlPattern,
  activationUrlPattern,
  signInRoute,
  signInUrlPattern,
  signUpRoute,
  signUpUrlPattern,
  verifyDeviceUrlPattern,
  verifyEmailUrlPattern,
} from './routes';

type VerificationOptions = {
  completeActivation?: boolean;
};

const postVerificationUrlPattern = /\/app\/en\/?$|\/app\/en\/(dashboard|activation)$/;

export const createCredentials = () => ({
  email: `engineer+e2e-${randomUUID()}@visomi-stack.test`,
  password: 'S3cureAuth!',
});

const fillCredentials = async (page: Page, email: string, password: string) => {
  const emailField = page.locator('#sign-up-email, #sign-in-email');

  const passwordField = page.getByRole('textbox', { name: 'Password', exact: true });

  const confirmField = page.getByRole('textbox', { name: 'Confirm password' });

  await expect(emailField).toBeVisible();
  await expect(emailField).toBeEditable();
  await expect(passwordField).toBeVisible();
  await expect(passwordField).toBeEditable();

  await emailField.fill(email);
  await expect(emailField).toHaveValue(email);
  await passwordField.fill(password);
  await expect(passwordField).toHaveValue(password);

  if (await confirmField.isVisible().catch(() => false)) {
    await confirmField.fill(password);
    await expect(confirmField).toHaveValue(password);
  }
};

const submitSignUpCredentials = async (page: Page, email: string, password: string) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await page.getByRole('button', { name: 'Use password instead' }).isVisible()) {
      await page.getByRole('button', { name: 'Use password instead' }).click();
    }
    await fillCredentials(page, email, password);
    await page.locator('[data-slot="submit"]').click();

    try {
      await expect(page).toHaveURL(verifyEmailUrlPattern, { timeout: 15000 });

      return;
    } catch (error) {
      if (attempt === 1 || !signUpUrlPattern.test(page.url())) {
        throw error;
      }
    }
  }
};

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

export const authenticateViaApi = async (page: Page, request: APIRequestContext, email: string, password: string) => {
  await clearMailbox(request);

  await page.goto(signUpRoute);
  await expect(page).toHaveURL(signUpUrlPattern);
  await submitSignUpCredentials(page, email, password);

  const pin = await readLatestPin(request, email, 'sign_up');

  await fillOtp(page, pin);
  await page.getByRole('button', { name: 'Verify and continue' }).click();

  await expect(page).toHaveURL(postVerificationUrlPattern, { timeout: 15000 });
  await waitForAuthenticatedSession(page, email);
  await completeActivationIfNeeded(page);
};

export const authenticateViaDeterministicTestSession = async (
  page: Page,
  request: APIRequestContext,
  email: string,
  password: string,
) => {
  await page.goto(signInRoute);
  await expect(page).toHaveURL(signInUrlPattern);
  const response = await request.post('/api/test/auth/session', {
    data: { email, password },
  });

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

export const signUp = async (page: Page, email: string, password: string) => {
  await page.goto(signUpRoute);
  await expect(page).toHaveURL(signUpUrlPattern);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await submitSignUpCredentials(page, email, password);
  await expect(page.getByRole('heading', { name: 'Verify email' })).toBeVisible();
};

export const signIn = async (page: Page, email: string, password: string) => {
  await page.goto(signInRoute);
  await expect(page).toHaveURL(signInUrlPattern);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('button', { name: 'Use password instead' }).click();
  await fillCredentials(page, email, password);
  await page.getByRole('checkbox', { name: 'Remember this device' }).check();
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(verifyDeviceUrlPattern, { timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Verify device' })).toBeVisible();
};

export const signInWithRememberedDevice = async (page: Page, email: string, password: string) => {
  await page.goto(signInRoute);
  await expect(page).toHaveURL(signInUrlPattern);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('button', { name: 'Use password instead' }).click();
  await fillCredentials(page, email, password);
  await page.getByRole('checkbox', { name: 'Remember this device' }).check();
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(appUrlPattern, { timeout: 15000 });
  await waitForAuthenticatedSession(page, email);
};

export const verifyLatestCode = async (
  page: Page,
  request: APIRequestContext,
  email: string,
  purpose: 'sign_in' | 'sign_up',
  options: VerificationOptions = {},
) => {
  const pin = await readLatestPin(request, email, purpose);

  await fillOtp(page, pin);
  await page.getByRole('button', { name: 'Verify and continue' }).click();

  await expect(page).toHaveURL(postVerificationUrlPattern, { timeout: 15000 });
  await waitForAuthenticatedSession(page, email);

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
  await signUp(page, email, password);
  await verifyLatestCode(page, request, email, 'sign_up', options);
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
  await expect(page).toHaveURL(/\/app\/en\/sign-in$/);
};
