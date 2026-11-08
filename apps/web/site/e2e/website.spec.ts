import { expect, test } from '@playwright/test';

import { disablePerformanceCapture } from './support/performance';
import { selectTheme } from './support/theme';

for (const locale of ['en', 'es']) {
  for (const width of [360, 1440]) {
    test(`the ${locale} website opens the mounted app at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });

      await page.goto(`/${locale}/`);

      const header = page.locator('[data-site-header]');
      const label = locale === 'en' ? 'Open app' : 'Abrir app';

      if (width < 1024) {
        await header.locator('[data-site-menu] summary').click();
      }

      const link = header.getByRole('link', { name: label, exact: true }).filter({ visible: true });

      await expect(link).toHaveAttribute('href', `/app/${locale}/`);

      await link.click();

      await expect(page).toHaveURL(new RegExp(`/app/${locale}/auth/sign-in$`));

      await expect(page.locator('html')).toHaveAttribute('lang', locale === 'en' ? 'en-US' : 'es');

      await expect(page.locator('[data-theme-switcher]')).toBeEnabled();
    });
  }

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
    await disablePerformanceCapture(page);

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
    // The fixed budget includes Vite's optional-module loader, but excludes the disabled performance SDK.
    expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThan(6144);
    expect(errors).toEqual([]);

    await page.getByRole('checkbox').uncheck();

    await expect(page.getByRole('checkbox')).not.toBeChecked();

    const switcher = page.getByRole('button', { name: locale === 'en' ? 'Dark theme' : 'Tema oscuro', exact: true });

    await expect(switcher).toBeEnabled();

    await expect(switcher).toHaveAttribute('aria-pressed', 'false');

    await switcher.focus();

    await page.keyboard.press('Space');

    await expect(switcher).toHaveAttribute('aria-pressed', 'true');

    await expect(page.locator('html')).toHaveClass('dark');

    await page.reload();

    await expect(switcher).toHaveAttribute('aria-pressed', 'true');

    await switcher.focus();

    await page.keyboard.press('Enter');

    await expect(switcher).toHaveAttribute('aria-pressed', 'false');

    await expect(page.locator('html')).toHaveClass('');

    expect(errors).toEqual([]);
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

        await selectTheme(page, theme);

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
    await selectTheme(page, theme);

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
