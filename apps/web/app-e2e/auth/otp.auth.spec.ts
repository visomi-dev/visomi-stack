import { expect, test, address, password } from './support/fixtures';

for (const locale of ['en', 'es']) {
  const spanish = locale === 'es';

  test(`${locale} verification code supports native editing and explicit submission`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });

    await page.emulateMedia({ colorScheme: spanish ? 'dark' : 'light' });

    await page.goto(`/app/${locale}/auth/sign-up/password`);

    await page.locator('input[type="email"]').fill(address());

    await page.locator('#account-password').fill(password);

    await page.locator('button[type="submit"]').click();

    const code = page.getByRole('textbox', { name: spanish ? 'Código de verificación' : 'Verification code' });
    const verify = page.getByRole('button', { name: spanish ? 'Verificar' : 'Verify', exact: true });
    const error = page.locator('#verification-code-error');
    const slots = page.locator('app-pin-input .slot');
    const widget = page.locator('app-pin-input > div');

    await expect(code).toBeEnabled();

    await expect(code).toHaveAccessibleDescription(spanish ? '6 dígitos' : '6 digits');

    await expect(code).toHaveAttribute('inputmode', 'numeric');

    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');

    await expect(slots).toHaveCount(6);

    await verify.click();

    await expect(code).toBeFocused();

    await expect(code).toHaveAttribute('aria-invalid', 'true');

    await expect(code).toHaveAccessibleDescription(
      spanish ? '6 dígitos Completa este campo.' : '6 digits Complete this field.',
    );

    let submitted: unknown;

    await page.route('**/api/auth/email/verify', (route) => {
      submitted = route.request().postDataJSON().code;

      return route.fulfill({ status: 400, json: { error: 'invalid_credentials' } });
    });

    await code.pressSequentially('001234');

    await code.press('ControlOrMeta+a');

    await code.press('ControlOrMeta+c');

    await code.press('Backspace');

    await expect(code).toHaveValue('');

    await code.press('ControlOrMeta+v');

    await expect(code).toHaveValue('001234');

    await code.press('ArrowLeft');

    await code.press('Shift+ArrowLeft');

    await code.press('7');

    await expect(code).toHaveValue('001274');

    await code.press('Backspace');

    await expect(code).toHaveValue('00124');

    await code.press('7');

    await code.press('Tab');

    await expect(code).toHaveValue('001274');

    await expect(verify).toBeFocused();

    await expect(code).not.toHaveAttribute('aria-invalid', 'true');

    await expect(code).toHaveAccessibleDescription(spanish ? '6 dígitos' : '6 digits');

    const fits = await code.evaluate((control) => control.getBoundingClientRect().right <= window.innerWidth);

    expect(fits).toBe(true);

    await verify.press('Shift+Tab');

    await expect(code).toBeFocused();

    await expect(widget).toHaveCSS('outline-style', 'solid');

    // 640 physical CSS pixels at 200% CSS zoom approximate a 320px layout viewport.
    await page.setViewportSize({ width: 640, height: 700 });

    await page.evaluate(() => (document.documentElement.style.zoom = '2'));

    const rightmostSlotFits = await slots
      .last()
      .evaluate((slot) => slot.getBoundingClientRect().right <= window.innerWidth);

    expect(rightmostSlotFits).toBe(true);
    expect(submitted).toBeUndefined();

    await verify.click();

    await expect(page.getByRole('alert')).toBeVisible();

    expect(submitted).toBe('001274');

    await expect(code).toHaveValue('');

    await expect(error).toBeHidden();
  });
}
