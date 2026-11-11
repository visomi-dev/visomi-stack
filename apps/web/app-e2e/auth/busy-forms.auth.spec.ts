/* eslint playwright/expect-expect: ["warn", { "assertFunctionNames": ["expect", "checkBusy"] }] */
import type { Locator, Page } from '@playwright/test';
import { readMailCode } from '@visomi-stack/dev-testing';

import { expect, test, address, password, signup, logout, passwordStart } from './support/fixtures';

async function pendingAccount(page: Page, locale: string): Promise<string> {
  const email = address();

  await page.goto(`/app/${locale}/auth/sign-up/password`);

  await page.locator('input[type="email"]').fill(email);

  await page.locator('#account-password').fill(password);

  await page.locator('button[type="submit"]').click();

  await expect(page.locator('#verification-code')).toBeEnabled();

  return email;
}

async function localizePasswordChallenge(page: Page, locale: string, email: string): Promise<void> {
  if (locale !== 'es') {
    return;
  }

  // Changing locales restarts this sensitive step; request a fresh localized challenge.
  await page.goto('/app/es/auth/sign-in/password');

  await page.locator('input[type="email"]').fill(email);

  await page.locator('#account-password').fill(password);

  await page.locator('button[type="submit"]').click();
}

async function fillSignupPassword(page: Page, path: string): Promise<void> {
  if (path === 'sign-up/password') {
    await page.locator('#account-password').fill(password);
  }
}

async function fillResetPassword(page: Page, flow: string): Promise<void> {
  if (flow === 'reset') {
    await page.locator('#reset-password').fill(password);
  }
}

async function checkBusy(page: Page, button: Locator, endpoint: string, screenshot: string): Promise<void> {
  await expect(button).toBeEnabled();

  await page.evaluate(() => document.fonts.ready);

  const before = await button.boundingBox();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;

  await page.route(`**/api/auth/${endpoint}`, async (route) => {
    requests++;

    await gate;

    await route.fulfill({ status: 400, json: { error: 'invalid_credentials' } });
  });

  try {
    await button.click();

    await expect(button).toHaveAttribute('aria-busy', 'true');

    await expect(button).toBeDisabled();

    await expect.poll(() => requests).toBe(1);

    await expect(page.locator('button[aria-busy="true"]')).toHaveCount(1);

    await expect(page.locator('app-auth-feedback [appUI="loader"]')).toHaveCount(0);

    await expect(page.getByRole('status', { name: /Working|Procesando/ })).toHaveCount(1);

    const during = await button.boundingBox();

    expect(during?.width).toBe(before?.width);
    expect(during?.height).toBe(before?.height);

    const indicator = await button.evaluate((element) => {
      const style = getComputedStyle(element, '::after');

      return { mask: style.maskImage, visibility: style.visibility, width: style.width, height: style.height };
    });

    expect(indicator.mask).toMatch(/isotype|visomi-loader/);
    expect(indicator.visibility).toBe('visible');
    expect(indicator.width).toBe('16px');
    expect(indicator.height).toBe('16px');

    await button.evaluate((element: HTMLButtonElement) => element.click());

    expect(requests).toBe(1);

    await page.screenshot({ path: test.info().outputPath(screenshot), animations: 'disabled' });
  } finally {
    release();
  }

  await expect(button).toHaveAttribute('aria-busy', 'false');

  if (endpoint === 'challenges/resend') {
    await expect(button).toBeDisabled();

    await page.clock.fastForward(61_000);
  }

  await expect(button).toBeEnabled();

  await expect(page.locator('[data-action-error]')).toBeFocused();
}

for (const locale of ['en', 'es']) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`${locale} ${theme} form progress`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: theme === 'light' ? 320 : 1280, height: 900 });

        await page.emulateMedia({ colorScheme: theme, reducedMotion: theme === 'light' ? 'reduce' : 'no-preference' });
      });

      for (const [path, endpoint] of [
        ['sign-up', 'passkeys/registration/options'],
        ['sign-up/password', 'password/sign-up'],
        ['forgot-password', 'password/reset/request'],
        ['recovery', 'recovery/request'],
        ['device-approval', 'device-approval/request'],
      ]) {
        test(`${path} keeps progress in its initiating button`, async ({ page, browserName }) => {
          // eslint-disable-next-line playwright/no-skipped-test -- WebAuthn coverage uses Chromium.
          test.skip(path === 'sign-up' && browserName !== 'chromium', 'Passkey browser coverage uses Chromium.');

          await page.goto(`/app/${locale}/auth/${path}`);

          await page.locator('input[type="email"]').fill(address());

          await fillSignupPassword(page, path);

          await checkBusy(
            page,
            page.locator('button[type="submit"]'),
            endpoint,
            `${path.split('/').join('-')}-busy.png`,
          );
        });
      }

      test('passkey cancellation restores the initiating button', async ({ page, browserName }) => {
        // eslint-disable-next-line playwright/no-skipped-test -- WebAuthn coverage uses Chromium.
        test.skip(browserName !== 'chromium', 'Passkey browser coverage uses Chromium.');

        await page.addInitScript(() => {
          Object.defineProperty(navigator.credentials, 'create', {
            configurable: true,
            value: () =>
              new Promise((_resolve, reject) => {
                (window as Window & { cancelSyntheticPasskey?: () => void }).cancelSyntheticPasskey = () =>
                  reject(new DOMException('Synthetic cancellation', 'NotAllowedError'));
              }),
          });
        });

        await page.goto(`/app/${locale}/auth/sign-up`);

        await page.locator('input[type="email"]').fill(address());

        const button = page.locator('button[type="submit"]');

        await expect(button).toHaveText(locale === 'es' ? 'Crear cuenta' : 'Create account with a passkey');

        const before = await button.boundingBox();

        await button.click();

        await expect(button).toHaveAttribute('aria-busy', 'true');

        await expect
          .poll(() =>
            page.evaluate(
              () => typeof (window as Window & { cancelSyntheticPasskey?: () => void }).cancelSyntheticPasskey,
            ),
          )
          .toBe('function');

        await expect(page.locator('app-auth-feedback [appUI="loader"]')).toHaveCount(0);

        await page.evaluate(() => {
          (window as Window & { cancelSyntheticPasskey?: () => void }).cancelSyntheticPasskey!();
        });

        await expect(button).toBeEnabled();

        await expect(button).toHaveAttribute('aria-busy', 'false');

        await expect(page.locator('[data-action-error]')).toBeFocused();

        const after = await button.boundingBox();

        expect(after?.width).toBe(before?.width);
        expect(after?.height).toBe(before?.height);

        await expect(page).toHaveURL(`/app/${locale}/auth/sign-up`);
      });

      test('email verification does not mark sign-out busy', async ({ page }) => {
        await pendingAccount(page, locale);

        await page.locator('#verification-code').fill('001234');

        await checkBusy(page, page.locator('app-code-entry button'), 'email/verify', 'verify-email-busy.png');
      });

      test('resend keeps its own progress and accessible announcement', async ({ page }) => {
        await page.clock.install();

        await pendingAccount(page, locale);

        await page.clock.fastForward(61_000);

        await checkBusy(page, page.locator('app-resend-code button'), 'challenges/resend', 'resend-busy.png');
      });

      for (const flow of ['reset', 'recovery'] as const) {
        test(`${flow} code form keeps progress in its submit button`, async ({ page }) => {
          const email = await signup(page);

          await logout(page);

          await page.goto(`/app/${locale}/auth/${flow === 'reset' ? 'forgot-password' : 'recovery'}`);

          await page.locator('input[type="email"]').fill(email);

          await page.locator('button[type="submit"]').click();

          const input = page.locator(flow === 'reset' ? '#reset-code' : '#recovery-email-code');

          await expect(input).toBeEnabled();

          const code = await readMailCode(email);

          await input.fill(code);

          await fillResetPassword(page, flow);

          await checkBusy(
            page,
            page.locator('button[type="submit"]'),
            flow === 'reset' ? 'password/reset/complete' : 'recovery/verify',
            `${flow}-verify-busy.png`,
          );
        });
      }

      test('reauthentication marks only the password submit button', async ({ page }) => {
        await signup(page);

        await page.goto(`/app/${locale}/auth/reauthenticate`);

        await page.locator('#reauth-password').fill(password);

        await checkBusy(page, page.locator('button[type="submit"]'), 'reauth/password/start', 'reauth-busy.png');
      });

      test('password changes keep progress in the save button', async ({ page }) => {
        await signup(page);

        await page.goto(`/app/${locale}/security/password`);

        await page.locator('#manage-password').fill(password);

        await checkBusy(page, page.locator('button[type="submit"]'), 'password/change', 'password-change-busy.png');
      });

      test('account email change keeps progress in the email form', async ({ page }) => {
        await signup(page);

        await page.goto(`/app/${locale}/account`);

        await page.locator('input[type="email"]').fill(address());

        await checkBusy(page, page.locator('app-email-entry button'), 'email/change/request', 'change-email-busy.png');
      });

      test('password factor verification uses the code button', async ({ page }) => {
        const email = await signup(page);

        await logout(page);

        await passwordStart(page, email);

        await localizePasswordChallenge(page, locale, email);

        const code = await readMailCode(email);

        await page.locator('#verification-code').fill(code);

        await checkBusy(page, page.locator('app-code-entry button'), 'password/verify', 'password-verify-busy.png');
      });
    });
  }
}
