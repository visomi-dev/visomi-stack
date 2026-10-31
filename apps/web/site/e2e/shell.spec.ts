import { expect, test } from '@playwright/test';

for (const locale of ['en', 'es']) {
  test(`the ${locale} shell renders through Express with only the theme scripts`, async ({ page, request }) => {
    const path = `/${locale}/ui/shell/`;
    const response = await request.get(path);
    const html = await response.text();

    expect(response.status()).toBe(200);
    expect(html.match(/<main /g)).toHaveLength(1);
    expect(html).toContain('id="shell-main"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('astro-island');
    expect(html).not.toContain('ng-version');
    expect(response.headers()['content-security-policy']).not.toContain('unsafe-inline');
    const scripts: Promise<number>[] = [];
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (resource) => {
      if (resource.request().resourceType() === 'script') {
        scripts.push(resource.body().then((body) => body.length));
      }
    });

    await page.goto(path);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.locator('[data-theme-select]').selectOption('dark');

    await expect(page.locator('html')).toHaveClass('dark');

    const sizes = await Promise.all(scripts);

    expect(sizes).toHaveLength(1);
    expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThan(2048);
    expect(errors).toEqual([]);
  });
}

for (const width of [360, 1023, 1024, 1440]) {
  test(`native shell navigation at ${width}px without JavaScript`, async ({ browser }, info) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width, height: 850 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      baseURL: info.project.use.baseURL,
    });

    try {
      const page = await context.newPage();

      await page.goto('/es/ui/shell/');

      const navigation = page.getByRole('navigation', { name: 'Navegación principal', exact: true });

      await expect(page.getByRole('main')).toHaveCount(1);

      await expect(navigation).toHaveCount(1);

      await expect(navigation.locator('a[aria-current=page]')).toHaveText('Resumen');

      await page.evaluate(() => document.fonts.ready);

      await page.screenshot({ path: info.outputPath('shell-initial.png'), animations: 'disabled' });

      await page.keyboard.press('Tab');

      await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();

      await page.keyboard.press('Enter');

      await expect(page.getByRole('main')).toBeFocused();

      await navigation.getByRole('link', { name: 'Ajustes', exact: true }).click();

      await expect(page).toHaveURL(/#shell-settings$/);

      const action = page.getByRole('main').getByRole('link', { name: 'Volver a componentes' });

      await action.focus();

      const geometry = await action.evaluate((element) => {
        const target = element.getBoundingClientRect();
        const mobile = Array.from(document.querySelectorAll('nav'))
          .find((nav) => getComputedStyle(nav.parentElement as HTMLElement).position === 'fixed')
          ?.getBoundingClientRect();

        return { bottom: target.bottom, navigationTop: mobile && mobile.height > 0 ? mobile.top : innerHeight };
      });

      expect(geometry.bottom).toBeLessThanOrEqual(geometry.navigationTop);
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
    } finally {
      await context.close();
    }
  });
}
