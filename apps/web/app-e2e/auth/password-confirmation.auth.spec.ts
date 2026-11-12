import { expect, test, signup, expireAuthentication } from './support/fixtures';

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
      name: spanish ? 'Confirma el cambio de contraseña' : 'Confirm your password change',
      exact: true,
    });

    await expect(heading).toBeVisible();

    await expect(heading).toBeFocused();

    await expect(page).toHaveURL(`/app/${locale}/security/password`);

    await expect(password).toHaveCount(0);

    await expect(
      page.getByRole('button', {
        name: spanish ? 'Confirmar con tu contraseña' : 'Confirm with your password',
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
}
