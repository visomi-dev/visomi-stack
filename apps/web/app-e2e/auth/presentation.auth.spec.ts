import type { Locator, Page } from '@playwright/test';
import { readMailCode } from '@visomi-stack/dev-testing';

import { expect, test, address, password, signup } from './support/fixtures';

async function separated(first: Locator, second: Locator, horizontal = false): Promise<void> {
  await expect
    .poll(async () => {
      const [before, after] = await Promise.all([first.boundingBox(), second.boundingBox()]);

      if (!before || !after) {
        return -1;
      }

      return horizontal ? after.x - before.x - before.width : after.y - before.y - before.height;
    })
    .toBeGreaterThanOrEqual(12);
}

async function reviewSizes(page: Page, check: () => Promise<void>): Promise<void> {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });

    for (const dark of [false, true]) {
      const toggle = page.locator('button[app-theme-switcher]');

      await expect(toggle).toBeEnabled();

      const selected = await toggle.getAttribute('aria-pressed');

      if (selected !== String(dark)) {
        await toggle.click();
      }

      await expect(toggle).toHaveAttribute('aria-pressed', String(dark));

      await page.evaluate(() => document.fonts.ready);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

      expect(overflow).toBeLessThanOrEqual(1);

      await check();
    }
  }
}

test('keeps access actions separated, password controls usable and language changes explicit', async ({ page }) => {
  await page.goto('/app/es/auth/sign-up/password');

  await expect(
    page.getByRole('navigation', { name: 'Idioma', exact: true }).locator('[aria-current="true"]'),
  ).toHaveText('Español');

  await expect(page.getByRole('link', { name: 'Español', exact: true })).toHaveCount(0);

  const input = page.locator('#account-password');
  const toggle = page.getByRole('button', { name: 'Mostrar u ocultar contraseña', exact: true });

  await input.fill(password);

  await reviewSizes(page, async () => {
    const bounds = await toggle.boundingBox();

    expect(bounds?.height).toBeGreaterThanOrEqual(44);

    await toggle.click();

    await expect(input).toHaveAttribute('type', 'text');

    await expect(input).toHaveValue(password);

    await toggle.click();

    await expect(input).toHaveAttribute('type', 'password');
  });

  await page.goto('/app/en/auth/reset-password');

  await expect(page.getByRole('status').filter({ hasText: 'This step could not be restored.' })).toContainText(
    'This step could not be restored.',
  );

  await reviewSizes(page, async () => {
    const bounds = await page.getByRole('link', { name: 'Start again', exact: true }).boundingBox();

    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  });

  await page.goto('/app/en/auth/sign-up/password');

  const email = address();

  await page.getByLabel('Email address', { exact: true }).fill(email);

  await page.getByLabel('Password', { exact: true }).fill(password);

  await page.getByRole('button', { name: 'Create an account', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Verify your email', exact: true })).toBeVisible();

  await reviewSizes(page, async () => {
    const verify = page.getByRole('button', { name: 'Verify', exact: true });
    const resend = page.getByRole('button', { name: /Send a new code/ });
    const exit = page.getByRole('button', { name: 'Sign out', exact: true });

    await separated(verify, resend);

    await separated(resend, exit);

    await exit.scrollIntoViewIfNeeded();

    await expect(exit).toBeInViewport();
  });

  const code = await readMailCode(email);
  const incorrect = ((Number(code) + 1) % 1_000_000).toString().padStart(6, '0');

  await page.getByLabel('Verification code', { exact: true }).fill(incorrect);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('We could not verify these details.');

  await expect(page.getByLabel('Verification code', { exact: true })).not.toHaveAttribute('aria-invalid', 'true');

  await expect(page.getByText('Complete this field.', { exact: true })).toBeHidden();

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Welcome home.', exact: true })).toBeVisible();
});

test('keeps security navigation apart from actions and groups destructive confirmations', async ({ page }) => {
  await signup(page);

  await page.goto('/app/en/security');

  await reviewSizes(page, async () => {
    const hierarchy = await page.locator('main').evaluate((main) => {
      const titleSize = Number.parseFloat(getComputedStyle(main.querySelector('h1')!).fontSize);

      return [...main.querySelectorAll('h2')].every(
        (heading) => Number.parseFloat(getComputedStyle(heading).fontSize) < titleSize,
      );
    });

    expect(hierarchy).toBe(true);
  });

  for (const [path, action] of [
    ['passkeys', 'Add a passkey'],
    ['totp', 'Set up authenticator'],
    ['recovery-codes', 'Replace backup codes'],
    ['password', 'Remove password'],
  ]) {
    await page.goto('/app/en/security/' + path);

    await expect(page.getByRole('button', { name: action, exact: true })).toBeEnabled();

    await reviewSizes(page, () =>
      separated(
        page.getByRole('button', { name: action, exact: true }),
        page.getByRole('link', { name: 'Back to security', exact: true }),
      ),
    );
  }

  await page.goto('/app/en/security/google');

  await expect(
    page.getByRole('status').filter({ hasText: 'Google sign-in is not available right now.' }),
  ).toContainText('Google sign-in is not available right now.');

  await page.goto('/app/en/security/recovery-codes');

  await page.getByRole('button', { name: 'Replace backup codes', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Replace backup codes', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  await reviewSizes(page, async () => {
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true });
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });

    await separated(confirm, cancel, page.viewportSize()!.width >= 640);

    await separated(cancel, page.getByRole('link', { name: 'Back to security', exact: true }));

    await cancel.focus();

    await cancel.scrollIntoViewIfNeeded();

    const navigation = page.locator('nav[appUI="navbar"]');

    const [button, bar] = await Promise.all([cancel.boundingBox(), navigation.boundingBox()]);

    expect(button!.y + button!.height).toBeLessThanOrEqual(bar?.y ?? page.viewportSize()!.height);
  });

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Replace backup codes', exact: true })).toBeFocused();
});
