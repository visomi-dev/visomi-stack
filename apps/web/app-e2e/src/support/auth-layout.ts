import { expect, type Page } from '@playwright/test';

export async function assertOpenDesignChrome(page: Page): Promise<void> {
  await expect(page.locator('[data-od-id="auth-shell"]')).toBeVisible();
  await expect(page.locator('[data-od-id="brand"]')).toContainText('Visomi Stack');
  await expect(page.locator('[data-od-id="lang-menu"]')).toBeVisible();
  await expect(page.locator('[data-od-id="theme-toggle"]')).toBeVisible();
  await expect(page.locator('[data-od-id="theme-toggle"]')).toHaveAttribute('aria-label', 'Toggle light/dark theme');
}

export type AuthRoute =
  | 'sign-in'
  | 'sign-up'
  | 'forgotten-password'
  | 'verify-email'
  | 'verify-device'
  | 'reset-password';

const OPEN_DESIGN_COPY: Readonly<Record<AuthRoute, Readonly<Record<string, string>>>> = Object.freeze({
  'sign-in': Object.freeze({
    kicker: 'Account access',
    title: 'Sign in',
    submit: 'Sign in',
    footer: 'Create an account',
    sub: 'Welcome back. Use your work email to access your Visomi Stack workspace.',
  }),
  'sign-up': Object.freeze({
    kicker: 'New account',
    title: 'Create your account',
    submit: 'Create account',
  }),
  'forgotten-password': Object.freeze({
    kicker: 'Account recovery',
    title: 'Recover password',
    submit: 'Send recovery link',
    sub: "Enter your work email and we'll send you a recovery link. The link expires in 30 minutes.",
  }),
  'verify-email': Object.freeze({
    kicker: 'Email verification',
    title: 'Verify email',
    submit: 'Verify and continue',
  }),
  'verify-device': Object.freeze({
    kicker: 'Device verification',
    title: 'Verify device',
    submit: 'Verify and continue',
  }),
  'reset-password': Object.freeze({
    kicker: 'Password reset',
    title: 'Reset your password',
    submit: 'Verify code',
    sub: 'Enter the 6-digit code we sent to your email, then choose a new password.',
  }),
});

export async function assertOpenDesignCopy(page: Page, route: AuthRoute): Promise<void> {
  await assertOpenDesignChrome(page);
  const expected = OPEN_DESIGN_COPY[route];

  for (const [slot, text] of Object.entries(expected)) {
    await expect(page.locator(`[data-slot="${slot}"]`).first()).toContainText(text);
  }
}
