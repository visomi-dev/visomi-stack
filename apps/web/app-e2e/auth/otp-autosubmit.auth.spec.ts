import type { Locator, Page } from '@playwright/test';
import { readMailCode } from '@visomi-stack/dev-testing';

import { address, expect, logout, password, passwordStart, signup, test } from './support/fixtures';

async function startAccount(page: Page): Promise<string> {
  const email = address();

  await page.goto('/app/en/auth/sign-up/password');

  await page.getByLabel('Email address', { exact: true }).fill(email);

  await page.getByLabel('Password', { exact: true }).fill(password);

  await page.getByRole('button', { name: 'Create an account', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();

  return email;
}

async function startNewDevice(page: Page): Promise<string> {
  const email = await signup(page);

  await logout(page);

  await passwordStart(page, email);

  return email;
}

async function paste(input: Locator, code: string) {
  await input.focus();

  await input.evaluate((element, value) => {
    const formatted = value.slice(0, 3) + '-' + value.slice(3);
    const event = new Event('paste', { bubbles: true, cancelable: true });

    Object.defineProperty(event, 'clipboardData', { value: { getData: () => formatted } });
    element.dispatchEvent(event);
  }, code);
}

async function autofill(input: Locator, code: string) {
  // Model the native replacement event produced when a browser supplies the whole code.
  await input.evaluate((element, value) => {
    (element as HTMLInputElement).value = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
  }, code);
}

for (const [label, endpoint, start, retry] of [
  ['account email', '**/api/auth/email/verify', startAccount, paste],
  ['new-device email', '**/api/auth/password/verify', startNewDevice, autofill],
] as const) {
  test(`${label} verifies a complete OTP exactly once and allows an explicit retry`, async ({ page }) => {
    const email = await start(page);
    const code = await readMailCode(email);
    const incorrect = code.slice(0, 5) + ((Number(code.at(-1)) + 1) % 10);
    const input = page.getByRole('textbox', { name: 'Verification code' });
    const form = page.locator('app-code-entry form');

    let attempts = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route(endpoint, async (route) => {
      attempts++;

      if (attempts === 1) {
        await held;
      }

      await route.continue();
    });

    const tiles = page.locator('app-code-entry app-pin-input .slot');

    await expect(tiles).toHaveCount(6);

    await expect(input).toHaveAttribute('autocomplete', 'one-time-code');

    await expect(input).toHaveAttribute('aria-describedby', 'verification-code-help');

    await expect(page.locator('#verification-code-help')).toHaveClass(/sr-only/);

    await expect(page.getByRole('button', { name: 'Verify', exact: true })).toHaveCount(0);

    await expect(input).toBeEnabled();

    try {
      await input.pressSequentially(incorrect.slice(0, 5));

      await expect(input).toHaveValue(incorrect.slice(0, 5));

      expect(attempts).toBe(0);

      await input.press(incorrect.at(-1)!);

      await expect(form).toHaveAttribute('aria-busy', 'true');

      await expect(page.getByRole('status').filter({ hasText: 'Verifying code…' })).toBeVisible();

      await expect(input).toBeDisabled();

      await expect.poll(() => attempts).toBe(1);

      await input.evaluate((element, value) => {
        (element as HTMLInputElement).value = value;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
      }, incorrect);

      expect(attempts).toBe(1);
    } finally {
      release();
    }

    const error = page.getByRole('alert').filter({ hasText: 'We couldn’t verify these details.' });

    await expect(error).toBeFocused();

    await expect(input).toBeEnabled();

    await expect(input).toHaveValue('');

    expect(attempts).toBe(1);

    await retry(input, code);

    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

    expect(attempts).toBe(2);
  });
}
