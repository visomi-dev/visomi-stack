import { expect, test, address } from './support/fixtures';

test('presents direct actions in both languages, mobile and dark mode', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/app/es/auth/sign-in');

  await expect(page.getByRole('heading', { name: 'Entra a tu espacio.', exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Entrar con una clave de acceso', exact: true })).toBeVisible();

  await expect(page.getByRole('link', { name: 'Usar contraseña', exact: true })).toBeVisible();

  const switcher = page.getByRole('button', { name: 'Tema oscuro', exact: true });

  await expect(switcher).toBeEnabled();

  await switcher.focus();

  await page.keyboard.press('Space');

  await expect(switcher).toHaveAttribute('aria-pressed', 'true');

  await expect(page.locator('html')).toHaveClass(/dark/);

  const result2 = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  expect(result2).toBe(true);

  await page.evaluate(() => document.fonts.ready);

  await page.screenshot({ path: info.outputPath('sign-in-es-mobile-dark.png'), animations: 'disabled' });

  await page.getByRole('link', { name: 'Usar contraseña', exact: true }).click();

  await expect(page.getByRole('link', { name: 'English', exact: true })).toHaveAttribute(
    'href',
    '/app/en/auth/sign-in/password',
  );

  await page.getByRole('link', { name: 'English', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Sign in with a password', exact: true })).toBeVisible();

  await page.getByLabel('Email address', { exact: true }).fill('invalid-email');

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.locator('#password-email')).toHaveAttribute('aria-invalid', 'true');

  await expect(page.locator('#password-email')).toBeFocused();

  await page.getByLabel('Email address', { exact: true }).fill(address());

  await page.getByLabel('Password', { exact: true }).fill('synthetic-incorrect-password');

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('We could not verify these details.');

  await expect(page.getByRole('alert')).toBeFocused();

  await expect(page.getByLabel('Password', { exact: true })).not.toHaveAttribute('aria-invalid', 'true');

  await expect(page.getByText('Complete this field.', { exact: true })).toBeHidden();

  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto('/app/en/auth/sign-in');

  const lightSwitcher = page.getByRole('button', { name: 'Dark theme', exact: true });

  await expect(lightSwitcher).toBeEnabled();

  await expect(lightSwitcher).toHaveAttribute('aria-pressed', 'true');

  await lightSwitcher.focus();

  await page.keyboard.press('Enter');

  await expect(lightSwitcher).toHaveAttribute('aria-pressed', 'false');

  await expect(page.locator('html')).not.toHaveClass(/dark/);

  await page.screenshot({ path: info.outputPath('sign-in-en-desktop-light.png'), animations: 'disabled' });

  await page.emulateMedia({ reducedMotion: 'reduce' });

  await expect(lightSwitcher.locator('svg').first()).toHaveCSS('transition-property', 'none');

  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

  expect(overflow).toBe(false);

  await expect(page.getByRole('button', { name: 'Sign in with a passkey', exact: true })).toBeVisible();
});
