import { expect, test } from '@playwright/test';

for (const locale of ['en', 'es']) {
  test(`public ${locale} pages render complete HTML through Express`, async ({ request }) => {
    for (const suffix of ['', 'architecture/', 'docs/', 'foundations/', 'ui/']) {
      const response = await request.get(`/${locale}/${suffix}`);
      const html = await response.text();

      expect(response.status()).toBe(200);
      expect(html).toContain(`<html lang="${locale}"`);
      expect(html.match(/<main /g)).toHaveLength(1);
      expect(html.match(/<h1[ >]/g)).toHaveLength(1);
      expect(html).toContain('property="og:description"');
      expect(html).toContain('rel="icon"');
      expect(html).not.toContain('astro-island');
      expect(html).not.toContain('ng-version');
      expect(response.headers()['content-security-policy']).not.toContain('unsafe-inline');
    }
  });

  test(`the ${locale} homepage keeps theme and error reporting scripts small`, async ({ page }) => {
    const scripts: Promise<number>[] = [];
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (resource) => {
      if (resource.request().resourceType() === 'script') {
        scripts.push(resource.body().then((body) => body.length));
      }
    });

    await page.goto(`/${locale}/`);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const sizes = await Promise.all(scripts);

    expect(sizes).toHaveLength(2);
    expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThan(4096);
    expect(errors).toEqual([]);

    await page.getByRole('checkbox').uncheck();

    await expect(page.getByRole('checkbox')).not.toBeChecked();
  });
}

test('mobile navigation and locale changes work without JavaScript', async ({ browser }, info) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 360, height: 800 },
    reducedMotion: 'reduce',
    baseURL: info.project.use.baseURL,
  });

  try {
    const page = await context.newPage();

    await page.goto('/es/');

    await page.keyboard.press('Tab');

    await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();

    await page.keyboard.press('Enter');

    await expect(page.getByRole('main')).toBeFocused();

    const menu = page.locator('[data-site-menu]');

    await menu.locator('summary').focus();

    await page.keyboard.press('Space');

    await expect(menu).toHaveAttribute('open', '');

    await menu.getByRole('link', { name: 'Arquitectura', exact: true }).click();

    await expect(page).toHaveURL(/\/es\/architecture\/$/);

    await page.getByRole('navigation', { name: 'Idioma', exact: true }).getByRole('link', { name: 'EN' }).click();

    await expect(page).toHaveURL(/\/en\/architecture\/$/);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('One system. Clear boundaries.');

    await page.goto('/es/');

    const question = page.getByText('¿Por qué combinar Astro y Angular?', { exact: true });

    await question.click();

    await expect(question.locator('..')).toHaveAttribute('open', '');
  } finally {
    await context.close();
  }
});

test('public navigation points to real routes and anchor targets', async ({ page, request }) => {
  const paths = new Set<string>();

  for (const route of ['/es/', '/es/docs/', '/es/architecture/', '/es/foundations/', '/es/ui/']) {
    await page.goto(route);

    const destinations = await page
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));

    for (const destination of destinations) {
      if (destination.startsWith('/es/') || destination.startsWith('/en/')) {
        paths.add(destination.split('#')[0]);
      }

      if (destination.startsWith('#')) {
        await expect(page.locator(`[id="${destination.slice(1)}"]`)).toHaveCount(1);
      }
    }
  }

  for (const path of paths) {
    const response = await request.get(path);

    expect(response.status(), path).toBe(200);
  }
});

for (const width of [320, 360, 768, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`public website at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });

      await page.emulateMedia({ reducedMotion: 'reduce' });

      for (const route of ['', 'architecture/', 'docs/']) {
        await page.goto(`/es/${route}`);

        await page.locator('[data-theme-select]').selectOption(theme);

        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? 'dark' : '');

        await page.evaluate(() => document.fonts.ready);

        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

        expect(fits, route).toBe(true);

        await expect(page.getByRole('main')).toHaveCount(1);

        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

        const suffix = route.replace(/\//g, '') || 'home';

        await page.screenshot({ path: info.outputPath(`${suffix}-viewport.png`), animations: 'disabled' });

        await page.screenshot({ path: info.outputPath(`${suffix}-full.png`), fullPage: true, animations: 'disabled' });
      }
    });
  }
}

test('the colored vision panel retains readable contrast in both themes', async ({ page }) => {
  await page.goto('/en/');

  for (const theme of ['light', 'dark']) {
    await page.locator('[data-theme-select]').selectOption(theme);

    const ratios = await page.locator('[aria-labelledby=vision-title]').evaluate((section) => {
      const canvas = document.createElement('canvas');

      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Canvas context unavailable');
      }

      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);

        return rgb
          .map((channel) => channel / 255)
          .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
          .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
      };
      const background = luminance(getComputedStyle(section).backgroundColor);

      return Array.from(section.querySelectorAll('h2, h3, p, a, span')).map((element) => {
        const foreground = luminance(getComputedStyle(element).color);

        return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
      });
    });

    expect(ratios.length).toBeGreaterThan(0);
    expect(ratios.every((ratio) => ratio >= 4.5)).toBe(true);
  }
});
