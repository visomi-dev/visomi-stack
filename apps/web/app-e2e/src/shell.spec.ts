import { expect, test } from '@playwright/test';

for (const width of [360, 1023, 1024, 1440]) {
  test(`Angular shell preserves native navigation and clear focus at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 850 });

    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });

    await page.goto('/app/es/');

    await expect(page.locator('app-root')).not.toHaveAttribute('ngh');

    const navigation = page.getByRole('navigation', { name: 'Navegación principal', exact: true });

    await expect(navigation).toHaveCount(1);

    await expect(navigation.locator('a[aria-current=page]')).toHaveCount(1);

    await page.evaluate(() => document.fonts.ready);

    await page.screenshot({ path: info.outputPath('shell-initial.png'), animations: 'disabled' });

    await page.keyboard.press('Tab');

    await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();

    await page.keyboard.press('Enter');

    await expect(page.getByRole('main')).toBeFocused();

    await navigation.getByRole('link', { name: width < 1024 ? 'Campos' : 'Validación de campos', exact: true }).click();

    await expect(page).toHaveURL(/#field-example$/);

    await page.locator('#angular-email').focus();

    const visible = await page.locator('#angular-email').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const topbar = document.querySelector('header[app-topbar]')?.getBoundingClientRect();
      const navbar = document.querySelector('nav[appUI=navbar]')?.getBoundingClientRect();

      return (
        rect.top >= Math.max(0, topbar?.bottom ?? 0) &&
        rect.bottom <= (navbar && navbar.height > 0 ? navbar.top : innerHeight)
      );
    });

    expect(visible).toBe(true);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

    expect(fits).toBe(true);
    const sizes = await navigation.getByRole('link').evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();

        return rect.width >= 44 && rect.height >= 44;
      }),
    );

    expect(sizes.every(Boolean)).toBe(true);

    await page.evaluate(() => document.fonts.ready);

    await page.screenshot({ path: info.outputPath('shell.png'), animations: 'disabled' });
  });
}
