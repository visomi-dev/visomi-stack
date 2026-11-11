import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/telemetry/config', (route) => route.fulfill({ json: {} }));
});

for (const locale of ['en', 'es']) {
  test(`${locale}: authentication links keep their hierarchy and destinations`, async ({ page }, testInfo) => {
    // Reuse native client navigation so the visual matrix stays within the SSR request limit.
    await page.goto(`/app/${locale}/auth/sign-up/password`);

    for (const theme of ['light', 'dark'] as const) {
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });

        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });

        const routes = [
          ['sign-up/password', ['sign-up']],
          ['sign-up', ['sign-in']],
          ['sign-in', ['sign-up', 'recovery']],
          ['recovery', ['device-approval', 'forgot-password', 'sign-in']],
          ['forgot-password', ['sign-in/password']],
          ['sign-in/password', ['sign-in']],
        ] as const;

        await expect(page.locator('form').getByRole('link')).toHaveCount(0);

        for (const [routeIndex, [path, destinations]] of routes.entries()) {
          await expect(page).toHaveURL(`/app/${locale}/auth/${path}`);

          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

          await expect(page.locator('app-root')).not.toHaveAttribute('ngh');

          await page.evaluate(() => document.fonts.ready);

          const footer = page.locator('section > footer');
          const links = footer.getByRole('link');

          await expect(links).toHaveCount(destinations.length);

          const bounds = await footer.boundingBox();

          expect(bounds).not.toBeNull();
          const boxes: { y: number; height: number }[] = [];

          for (let index = 0; index < destinations.length; index++) {
            const link = links.nth(index);

            await expect(link).toHaveAttribute('href', `/app/${locale}/auth/${destinations[index]}`);

            await expect(link).toBeVisible();

            const box = await link.boundingBox();

            expect(box).not.toBeNull();
            expect(box!.height).toBeGreaterThanOrEqual(44);
            const group = await link.evaluate((element) => {
              const rect = (
                element.parentElement?.tagName === 'P' ? element.parentElement : element
              ).getBoundingClientRect();

              return { x: rect.x, width: rect.width };
            });

            expect(Math.abs(group.x + group.width / 2 - (bounds!.x + bounds!.width / 2))).toBeLessThanOrEqual(1);

            boxes.push(box!);
          }

          const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

          expect(fits).toBe(true);

          for (const [index, box] of boxes.slice(1).entries()) {
            expect(box.y - (boxes[index].y + boxes[index].height)).toBeGreaterThanOrEqual(12);
          }

          await page.screenshot({
            path: testInfo.outputPath(`${locale}-${theme}-${width}-${path.replace('/', '-')}.png`),
            fullPage: true,
          });

          for (const [nextPath] of routes.slice(routeIndex + 1, routeIndex + 2)) {
            await page.locator(`section a[href="/app/${locale}/auth/${nextPath}"]`).click();
          }
        }

        const password = page.locator('#account-password');
        const email = page.locator('#password-email');
        const recovery = page.locator('form').getByRole('link');
        const submit = page.locator('button[type="submit"]');

        await email.fill('synthetic@example.test');

        await password.fill('synthetic test passphrase');

        await expect(recovery).toHaveCount(1);

        await expect(recovery).toHaveAttribute('href', `/app/${locale}/auth/forgot-password`);

        const fieldBox = await password.boundingBox();
        const recoveryBox = await recovery.boundingBox();
        const submitBox = await submit.boundingBox();

        expect(recoveryBox!.y - (fieldBox!.y + fieldBox!.height)).toBeGreaterThanOrEqual(0);
        expect(recoveryBox!.y - (fieldBox!.y + fieldBox!.height)).toBeLessThanOrEqual(24);
        expect(submitBox!.y - (recoveryBox!.y + recoveryBox!.height)).toBeGreaterThanOrEqual(12);

        await password.focus();

        await page.keyboard.press('Tab');

        await page.keyboard.press('Tab');

        await expect(recovery).toBeFocused();

        const outlineWidth = await recovery.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).outlineWidth),
        );

        expect(outlineWidth).toBeGreaterThan(0);

        await expect(email).toHaveValue('synthetic@example.test');

        await expect(password).toHaveValue('synthetic test passphrase');

        await page.keyboard.press('Enter');

        await expect(page).toHaveURL(`/app/${locale}/auth/forgot-password`);

        for (const destination of ['sign-in/password', 'sign-in', 'sign-up', 'sign-up/password']) {
          await page.locator(`section a[href="/app/${locale}/auth/${destination}"]`).click();
        }
      }
    }
  });
}
