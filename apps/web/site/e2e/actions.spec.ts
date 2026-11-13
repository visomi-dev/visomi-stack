import { expect, test } from '@playwright/test';

for (const locale of ['en', 'es']) {
  for (const width of [320, 390, 768, 1440]) {
    test(`${locale} actions align at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });

      await page.emulateMedia({ reducedMotion: 'reduce' });

      for (const route of ['', 'architecture/']) {
        await page.goto(`/${locale}/${route}`);

        await page.evaluate(() => document.fonts.ready);

        const layouts = await page.locator('[data-cta-group]').evaluateAll((groups) =>
          groups.map((group) => {
            const [first, second] = Array.from(group.children).map((element) => element.getBoundingClientRect());
            const parent = group.getBoundingClientRect();
            const sameRow = Math.abs(first.top - second.top) < 1;

            return {
              usableTargets: first.height >= 44 && second.height >= 44,
              equalWidths: Math.abs(first.width - second.width) < 1,
              fillsGroup: sameRow
                ? Math.abs(first.left - parent.left) < 1 && Math.abs(second.right - parent.right) < 1
                : Math.abs(first.width - parent.width) < 1 && Math.abs(second.width - parent.width) < 1,
              fits: first.left >= parent.left && second.right <= parent.right + 1,
              sameRow,
            };
          }),
        );

        expect(layouts.length).toBeGreaterThan(0);

        for (const layout of layouts) {
          expect(layout.usableTargets).toBe(true);
          expect(layout.fits).toBe(true);
          expect(width < 640 ? layout.equalWidths && layout.fillsGroup : layout.sameRow).toBe(true);
        }

        await page.screenshot({
          path: info.outputPath(`${route ? 'architecture' : 'home'}-actions.png`),
          fullPage: true,
        });
      }
    });
  }
}
