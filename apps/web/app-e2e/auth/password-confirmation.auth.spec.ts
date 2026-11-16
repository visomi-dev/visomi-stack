import { readMailCode } from '@visomi-stack/dev-testing';

import { expect, test, signup, expireAuthentication, password as existingPassword } from './support/fixtures';

for (const locale of ['en', 'es']) {
  test(`${locale} password confirmation keeps its context and discards a cancelled draft`, async ({ page }, info) => {
    const email = await signup(page);

    await expireAuthentication(email);

    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`/app/${locale}/security/password`);

    const spanish = locale === 'es';
    const password = page.getByLabel(spanish ? 'Nueva contraseña' : 'New password', { exact: true });
    const draft = 'Synthetic cancelled password 42!';

    await password.fill(draft);

    await page.getByRole('button', { name: spanish ? 'Guardar contraseña' : 'Save password', exact: true }).click();

    const heading = page.getByRole('heading', {
      name: spanish ? 'Confirma tu identidad' : 'Confirm your identity',
      exact: true,
    });

    await expect(heading).toBeVisible();

    await expect(heading).toBeFocused();

    await expect(page).toHaveURL(`/app/${locale}/security/password`);

    await expect(password).toHaveCount(0);

    await expect(
      page.getByRole('button', {
        name: spanish ? 'Continuar' : 'Continue',
        exact: true,
      }),
    ).toBeVisible();

    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));

    expect(storage).not.toContain(draft);

    await page.evaluate(() => document.fonts.ready);

    const textFits = await heading.evaluate((element) => {
      const range = document.createRange();

      range.selectNodeContents(element);
      const bounds = range.getBoundingClientRect();

      return bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth;
    });

    expect(textFits).toBe(true);

    await page.screenshot({ path: info.outputPath(`password-confirmation-${locale}.png`), animations: 'disabled' });

    await page.getByRole('button', { name: spanish ? 'Cancelar' : 'Cancel', exact: true }).click();

    await expect(password).toHaveValue('');

    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();

    await page.reload();

    await expect(password).toHaveValue('');
  });

  test(`${locale} separates identity confirmation, saving and the completed password change`, async ({
    page,
  }, info) => {
    const email = await signup(page);

    await expireAuthentication(email);

    await page.setViewportSize({ width: 390, height: 844 });

    await page.emulateMedia({ colorScheme: locale === 'es' ? 'dark' : 'light', reducedMotion: 'reduce' });

    // An alternate method keeps the current-password form collapsed; verification and saving use the real API.
    await page.route('**/api/auth/methods', async (route) => {
      const response = await route.fetch();
      const methods = await response.json();

      await route.fulfill({
        response,
        json: { ...methods, passkeys: [{ id: 'synthetic-preview-passkey', label: 'Synthetic passkey' }] },
      });
    });

    let changes = 0;
    let release!: () => void;
    const saving = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route('**/api/auth/password/change', async (route) => {
      changes++;

      if (changes === 2) {
        await saving;
      }

      await route.continue();
    });

    await page.goto(`/app/${locale}/security/password`);

    const spanish = locale === 'es';
    const newPassword = page.getByLabel(spanish ? 'Nueva contraseña' : 'New password', { exact: true });

    await newPassword.fill('Synthetic updated password 42!');

    await page.getByRole('button', { name: spanish ? 'Guardar contraseña' : 'Save password', exact: true }).click();

    const currentPassword = page.getByLabel(spanish ? 'Contraseña actual' : 'Current password', { exact: true });

    await expect(
      page.getByRole('heading', { name: spanish ? 'Confirma tu identidad' : 'Confirm your identity', exact: true }),
    ).toBeFocused();

    await expect(currentPassword).toBeHidden();

    const choice = page.locator('app-reauthenticate summary');

    await expect(choice).toHaveText(spanish ? 'Usar tu contraseña actual' : 'Use your current password');

    await page.evaluate(() => document.fonts.ready);

    await page.screenshot({ path: info.outputPath('choose-method.png'), animations: 'disabled' });

    await choice.focus();

    await page.keyboard.press('Space');

    await page.keyboard.press('Tab');

    await expect(currentPassword).toBeFocused();

    await currentPassword.fill(existingPassword);

    await page.getByRole('button', { name: spanish ? 'Continuar' : 'Continue', exact: true }).click();

    const verification = page.getByLabel(spanish ? 'Código de verificación' : 'Verification code', { exact: true });

    await expect(verification).toBeVisible();

    const code = await readMailCode(email);

    await verification.fill(code);

    await page.getByRole('button', { name: spanish ? 'Verificar' : 'Verify', exact: true }).click();

    try {
      await expect(
        page.getByRole('heading', { name: spanish ? 'Guardando tu contraseña' : 'Saving your password', exact: true }),
      ).toBeVisible();

      await expect(newPassword).toHaveCount(0);

      await expect(currentPassword).toHaveCount(0);

      await expect(
        page.getByRole('button', { name: spanish ? 'Guardar contraseña' : 'Save password', exact: true }),
      ).toBeDisabled();
    } finally {
      release();
    }

    const success = page.getByRole('heading', {
      name: spanish ? 'Contraseña guardada' : 'Password saved',
      exact: true,
    });

    await expect(success).toBeFocused();

    await expect(
      page.getByRole('button', { name: spanish ? 'Guardar contraseña' : 'Save password', exact: true }),
    ).toHaveCount(0);

    await expect(
      page.getByRole('button', { name: spanish ? 'Eliminar contraseña' : 'Remove password', exact: true }),
    ).toHaveCount(0);

    await expect(newPassword).toHaveCount(0);

    const back = page.getByRole('link', { name: spanish ? 'Volver a seguridad' : 'Back to security', exact: true });

    await expect(back).toHaveAttribute('href', `/app/${locale}/security`);

    const target = await back.boundingBox();

    expect(target!.height).toBeGreaterThanOrEqual(44);

    expect(changes).toBe(2);

    await page.screenshot({ path: info.outputPath('password-saved.png'), animations: 'disabled' });

    await page
      .getByRole('button', { name: spanish ? 'Volver a cambiar la contraseña' : 'Change password again', exact: true })
      .click();

    await expect(newPassword).toHaveValue('');

    await expect(
      page.getByRole('heading', { name: spanish ? 'Gestionar contraseña' : 'Manage password', exact: true }),
    ).toBeFocused();

    expect(changes).toBe(2);
  });
}
