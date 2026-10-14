import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Keep failure and late-response fixtures observable through the composed gateway.
test.use({ serviceWorkers: 'block' });

const flow = {
  flowId: '00000000-0000-4000-8000-000000000001',
  expiresAt: '2099-01-01T00:00:00Z',
  resendAvailableAt: '2099-01-01T00:00:00Z',
};

async function enterRegistration(page: Page, locale = 'en'): Promise<void> {
  await page.goto(`/app/${locale}/auth/sign-up?method=password`);
  await page
    .getByRole('textbox', { name: locale === 'es' ? 'Correo electrónico' : 'Email address', exact: true })
    .fill('continuity@example.test');
  await page.getByLabel(locale === 'es' ? 'Contraseña' : 'Password', { exact: true }).fill('synthetic-password');
  await page
    .getByLabel(locale === 'es' ? 'Confirmar contraseña' : 'Confirm password', { exact: true })
    .fill('synthetic-password');
}

for (const copy of [
  {
    locale: 'en',
    create: 'Create account',
    verify: 'Verify email',
    title: 'Your account is verified',
    continue: 'Sign in to continue',
  },
  {
    locale: 'es',
    create: 'Crear cuenta',
    verify: 'Verificar correo',
    title: 'Tu cuenta está verificada',
    continue: 'Inicia sesión para continuar',
  },
]) {
  test(`requires sign-in after verified signup without a session in ${copy.locale}`, async ({ page }) => {
    let verifications = 0;

    await page.route('**/api/auth/session', (route) =>
      route.fulfill({
        json: { data: { authenticated: false, kind: 'anonymous', user: null } },
      }),
    );
    await page.route('**/api/auth/password/sign-up', (route) => route.fulfill({ status: 202, json: { data: flow } }));
    await page.route('**/api/auth/password/sign-up/verify', (route) => {
      verifications += 1;

      return route.fulfill({ json: { data: { authenticated: true } } });
    });
    await enterRegistration(page, copy.locale);
    await page.getByRole('button', { name: copy.create, exact: true }).click();
    await page.locator('#sign-up-code').fill('123456');
    await page.getByRole('button', { name: copy.verify, exact: true }).click();
    await expect(page.getByRole('heading', { name: copy.title })).toBeVisible();
    await expect(page.getByRole('button', { name: copy.continue, exact: true })).toBeVisible();
    await expect(page.locator('#sign-up-code')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: copy.locale === 'es' ? 'Cambiar idioma' : 'Change language', exact: true }),
    ).toContainText(copy.locale.toUpperCase());
    await expect(page).toHaveScreenshot(`verified-without-session-${copy.locale}.png`, { fullPage: true });
    await page.getByRole('button', { name: copy.continue, exact: true }).click();
    await expect(page).toHaveURL(/auth\/sign-in/);
    expect(verifications).toBe(1);
  });
}

test('does not replay a consumed signup code after a failed session check', async ({ page }) => {
  let verified = false;
  let verifications = 0;

  await page.route('**/api/auth/session', (route) =>
    route.fulfill(
      verified
        ? { status: 503, json: { code: 'temporarily_unavailable' } }
        : { json: { data: { authenticated: false, kind: 'anonymous', user: null } } },
    ),
  );
  await page.route('**/api/auth/password/sign-up', (route) => route.fulfill({ status: 202, json: { data: flow } }));
  await page.route('**/api/auth/password/sign-up/verify', (route) => {
    verified = true;
    verifications += 1;

    return route.fulfill({ json: { data: { authenticated: true } } });
  });
  await enterRegistration(page);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.locator('#sign-up-code').fill('123456');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your account is verified' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('could not confirm that you are signed in');
  await expect(page.getByText('That verification code is not valid.')).toHaveCount(0);
  await expect(page.locator('#sign-up-code')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign in to continue', exact: true })).toBeVisible();
  expect(verifications).toBe(1);
});

test('ignores a late registration response after switching methods and switching back', async ({ page }) => {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });

  await page.route('**/api/auth/password/sign-up', async (route) => {
    requested();
    await released;
    await route.fulfill({ status: 202, json: { data: flow } });
  });

  try {
    await enterRegistration(page);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await started;
    await page.getByRole('link', { name: 'Use a passkey instead' }).click();
    await page.getByRole('link', { name: 'Use password instead' }).click();
    const response = page.waitForResponse('**/api/auth/password/sign-up');

    release();
    await response;
    await expect(page.getByRole('heading', { name: 'Create your account', exact: true })).toBeVisible();
    await expect(page.locator('#sign-up-code')).toHaveCount(0);
    await expect(page.locator('#sign-up-password')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeEnabled();
  } finally {
    release();
  }
});

for (const state of [
  { locale: 'en', change: 'Change language', option: 'Spanish', next: 'es', heading: 'Crea tu cuenta' },
  { locale: 'es', change: 'Cambiar idioma', option: 'Inglés', next: 'en', heading: 'Create your account' },
]) {
  test(`switches the auth language from ${state.locale} without losing route parameters`, async ({ page }) => {
    await page.goto(`/app/${state.locale}/auth/sign-up?method=password&source=language-test`);
    const language = page.getByRole('button', { name: state.change, exact: true });

    await expect(language).toContainText(state.locale.toUpperCase());
    await language.click();
    await page.getByRole('menuitem', { name: state.option, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/${state.next}/auth/sign-up\\?method=password&source=language-test`));
    await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${state.next}(?:-|$)`));
    await expect(page.getByRole('heading', { name: state.heading, exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: state.next === 'es' ? 'Cambiar idioma' : 'Change language' }),
    ).toContainText(state.next.toUpperCase());
  });
}
