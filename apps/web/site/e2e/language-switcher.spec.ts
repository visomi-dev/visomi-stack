import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/telemetry/config', (route) => route.fulfill({ json: {} }));
});

for (const locale of ['en', 'es']) {
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [320, 375, 720, 1440]) {
      test(`${locale} language link in ${theme} at ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 });

        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });

        await page.goto(`/${locale}/`);

        const header = page.locator('[data-site-header]');
        const language = header.locator('[data-language-switcher]');
        const destination = locale === 'en' ? 'es' : 'en';

        await expect(language).toHaveText(destination === 'es' ? 'Español' : 'English');

        await expect(language.locator('svg[aria-hidden="true"]')).toHaveCount(1);

        await expect(language).toHaveAttribute('lang', destination);

        await expect(language).toHaveAttribute('hreflang', destination);

        await expect(language).toHaveAttribute('href', `/${destination}/`);

        await expect(
          header
            .locator('nav[aria-label]')
            .filter({ has: page.locator('[data-language-switcher]') })
            .getByRole('link'),
        ).toHaveCount(1);

        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? 'dark' : '');

        const geometry = await language.evaluate((element) => {
          const link = element.getBoundingClientRect();
          const toggle = document.querySelector('[data-theme-switcher]')!.getBoundingClientRect();
          const style = getComputedStyle(element);
          const canvas = document.createElement('canvas').getContext('2d')!;
          const luminance = (color: string) => {
            canvas.fillStyle = color;
            canvas.fillRect(0, 0, 1, 1);
            const channels = Array.from(canvas.getImageData(0, 0, 1, 1).data)
              .slice(0, 3)
              .map((channel) => {
                const value = channel / 255;

                return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
              });

            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
          };
          const foreground = luminance(style.color);
          const background = luminance(style.backgroundColor);

          return {
            width: link.width,
            height: link.height,
            gap: toggle.left - link.right,
            fits: document.documentElement.scrollWidth <= innerWidth,
            contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
          };
        });

        expect(geometry.width).toBeGreaterThanOrEqual(44);
        expect(geometry.height).toBeGreaterThanOrEqual(44);
        expect(geometry.gap).toBeGreaterThanOrEqual(8);
        expect(geometry.fits).toBe(true);
        expect(geometry.contrast).toBeGreaterThanOrEqual(4.5);

        // 720 CSS px also covers the reflow width of a 1440px desktop at 200% zoom.
        await page.evaluate(() => document.fonts.ready);

        await page.screenshot({ path: info.outputPath('language-link.png'), animations: 'disabled' });

        await language.focus();

        await page.keyboard.press('Shift+Tab');

        await page.keyboard.press('Tab');

        await expect(language).toBeFocused();

        const focus = await language.evaluate((element) => {
          const style = getComputedStyle(element);

          return { width: style.outlineWidth, style: style.outlineStyle };
        });

        expect(focus.width).not.toBe('0px');
        expect(focus.style).not.toBe('none');

        await page.keyboard.press('Enter');

        await expect(page).toHaveURL(new RegExp(`/${destination}/$`));

        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? 'dark' : '');
      });
    }
  }

  test(`${locale} preserves the equivalent interior route, query and changing fragment`, async ({ page }) => {
    await page.goto(`/${locale}/architecture/?view=overview#direction`);

    const language = page.locator('[data-language-switcher]');
    const destination = locale === 'en' ? 'es' : 'en';

    await expect(language).toHaveAttribute('href', `/${destination}/architecture/?view=overview#direction`);

    await page.evaluate(() => {
      window.location.hash = 'principles-title';
    });

    await expect(language).toHaveAttribute('href', `/${destination}/architecture/?view=overview#principles-title`);

    await language.click();

    await expect(page).toHaveURL(new RegExp(`/${destination}/architecture/\\?view=overview#principles-title$`));

    await expect(page.locator('#principles-title')).toHaveCount(1);
  });

  test(`${locale} switches interior routes and query without JavaScript`, async ({ browser }, info) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL: info.project.use.baseURL,
      viewport: { width: 320, height: 900 },
    });

    try {
      const page = await context.newPage();
      const destination = locale === 'en' ? 'es' : 'en';

      await page.goto(`/${locale}/architecture/?view=overview`);

      const language = page.locator('[data-language-switcher]');

      await expect(language).toHaveAttribute('href', `/${destination}/architecture/?view=overview`);

      await language.click();

      await expect(page).toHaveURL(new RegExp(`/${destination}/architecture/\\?view=overview$`));

      await expect(page.locator('html')).toHaveAttribute('lang', destination);
    } finally {
      await context.close();
    }
  });
}

test('keeps an explicit theme preference when changing language', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

  await page.goto('/en/');

  await page.locator('[data-theme-switcher]').click();

  await expect(page.locator('html')).toHaveClass('dark');

  await page.locator('[data-language-switcher]').click();

  await expect(page).toHaveURL(/\/es\/$/);

  await expect(page.locator('html')).toHaveClass('dark');
});
