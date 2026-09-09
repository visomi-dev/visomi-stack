import { expect, test } from '@playwright/test';

const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

for (const locale of ['en', 'es']) {
  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of viewports) {
      test(`${locale}-${theme}-${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript((value) => localStorage.setItem('themis.theme', value), theme);
        await page.goto(`/${locale}/`);
        await page.addStyleTag({
          content: 'html { scroll-behavior: auto !important; } astro-dev-toolbar { display: none !important; }',
        });
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
        const heading = page.getByRole('heading', { level: 1 });

        await expect(heading).toBeVisible();
        await page.evaluate(async () => {
          await document.fonts.ready;
          for (const font of ['800 48px Manrope', '400 18px Inter', '700 12px "JetBrains Mono"']) {
            if (!(await document.fonts.load(font)).length) throw new Error(`Missing font: ${font}`);
          }
        });
        const hero = page.locator('section').filter({ has: heading });
        const screenshot = { animations: 'disabled' as const, caret: 'hide' as const };

        await page.screenshot({ ...screenshot, path: testInfo.outputPath('viewport.png') });
        await hero.screenshot({ ...screenshot, path: testInfo.outputPath('hero.png') });
        await page.evaluate(() => window.scrollTo(0, 0));

        const bounds = await hero.evaluate((element) => {
          const rect = element.getBoundingClientRect();

          return {
            heroBottom: rect.bottom,
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            overflowingText: [...element.querySelectorAll('h1, p, a')]
              .filter((node) => {
                const box = node.getBoundingClientRect();

                return box.left < 0 || box.right > window.innerWidth || node.scrollWidth > node.clientWidth + 1;
              })
              .map((node) => node.textContent?.trim()),
          };
        });

        await testInfo.attach('layout', { body: JSON.stringify(bounds), contentType: 'application/json' });
        expect.soft(bounds.overflow, 'Page must not overflow horizontally').toBeLessThanOrEqual(1);
        expect.soft(bounds.overflowingText, 'Hero text must not clip or overflow').toEqual([]);
        if (viewport.width >= 1024) {
          expect
            .soft(bounds.heroBottom, 'Desktop hero must fit below the navigation')
            .toBeLessThanOrEqual(viewport.height);
        }
        await expect(hero.getByRole('link').first()).toBeInViewport({ ratio: 1 });
        if (process.env['LANDING_BASELINE_DIR']) {
          await expect(page).toHaveScreenshot(`${testInfo.title}.png`, screenshot);
        }
      });
    }
  }
}
