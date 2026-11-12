import type { Page, TestInfo } from '@playwright/test';

import { expect, test, signup } from './support/fixtures';

test('animates an open mobile menu when the system theme changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });

  await signup(page);

  await page.goto('/app/en/home');

  await page.locator('nav[appUI="navbar"]').getByRole('button', { name: 'Menu', exact: true }).click();

  const dialog = page.getByRole('dialog');

  await expect(dialog).toBeVisible();

  for (const colorScheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme });

    await expect
      .poll(
        () =>
          dialog.evaluate((element) =>
            element
              .getAnimations()
              .some(
                (animation) =>
                  animation instanceof CSSTransition && animation.transitionProperty === 'background-color',
              ),
          ),
        { intervals: [0, 10, 20, 50] },
      )
      .toBe(true);

    const motion = await dialog.evaluate((element) => {
      const animation = element
        .getAnimations()
        .find((value) => value instanceof CSSTransition && value.transitionProperty === 'background-color')!;
      const timing = animation.effect!.getTiming();

      animation.pause();

      const samples = [0, 200, 399].map((time) => {
        animation.currentTime = time;

        return getComputedStyle(element).backgroundColor;
      });

      animation.finish();

      return { duration: timing.duration, easing: timing.easing, samples };
    });

    expect(motion.duration).toBe(400);
    expect(motion.easing).toBe('ease-in-out');
    expect(motion.samples[1]).not.toBe(motion.samples[0]);
    expect(motion.samples[1]).not.toBe(motion.samples[2]);

    await expect(page.locator('[data-theme-transition]')).toHaveCount(0);

    await expect(dialog).toBeVisible();
  }

  await page.keyboard.press('Escape');

  await expect(dialog).toBeHidden();
});

async function checkNavigation(page: Page, locale: string, width: number, info: TestInfo): Promise<void> {
  const navbar = page.locator('nav[appUI="navbar"]');
  const dialog = page.getByRole('dialog');

  if (width < 1024) {
    await expect(navbar.getByRole('link')).toHaveCount(3);

    await expect(navbar.getByRole('button')).toHaveText(locale === 'en' ? 'Menu' : 'Menú');

    await expect(navbar.locator('[aria-current="page"]')).toHaveCount(1);

    await expect(navbar.locator('svg[aria-hidden="true"]')).toHaveCount(4);

    const menu = navbar.getByRole('button');

    await menu.focus();

    await page.keyboard.press('Enter');

    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole('button', { name: /Close navigation|Cerrar navegación/ })).toBeFocused();

    await page.keyboard.press('Tab');

    await expect(dialog.getByRole('link').first()).toBeFocused();

    await page.keyboard.press('Shift+Tab');

    await expect(dialog.getByRole('button', { name: /Close navigation|Cerrar navegación/ })).toBeFocused();

    await page.screenshot({ path: info.outputPath('mobile-menu.png'), animations: 'disabled' });

    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();

    await expect(menu).toBeFocused();

    await menu.click();

    await dialog.getByRole('link', { name: locale === 'en' ? 'Account' : 'Cuenta', exact: true }).click();

    await expect(page).toHaveURL(`/app/${locale}/account`);

    await expect(dialog).toBeHidden();

    await menu.click();

    await page.setViewportSize({ width: 1280, height: 844 });

    await expect(dialog).toBeHidden();

    await expect(page.locator('app-sidebar')).toBeVisible();

    await page.setViewportSize({ width, height: 844 });

    await menu.click();

    await dialog.getByRole('button', { name: /Sign out|Cerrar sesión/ }).click();
  } else {
    await expect(navbar).toBeHidden();

    await page
      .locator('app-sidebar')
      .getByRole('button', { name: /Sign out|Cerrar sesión/ })
      .click();
  }
}

for (const locale of ['en', 'es']) {
  for (const width of [320, 390, 844, 1280]) {
    test(`${locale} shell at ${width}px keeps its header visible and navigation reachable`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });

      await page.emulateMedia({ colorScheme: width === 390 || width === 1280 ? 'dark' : 'light' });

      await signup(page);

      for (const route of ['home', 'account', 'security', 'home']) {
        await page.goto(`/app/${locale}/${route}`);

        const main = page.getByRole('main');
        const header = page.locator('header[app-topbar]');

        await expect(main.locator('h1')).toBeVisible();

        await expect(page.locator('[data-language-switcher]')).toHaveText(locale === 'en' ? 'Español' : 'English');

        await expect(page.locator('[data-language-switcher] svg[aria-hidden="true"]')).toHaveCount(1);

        const initial = await header.boundingBox();

        await main.evaluate((element) => {
          const fixture = document.createElement('div');

          fixture.setAttribute('data-scroll-fixture', '');
          fixture.style.minHeight = '2000px';
          fixture.textContent = 'Synthetic long content';
          element.append(fixture);
        });

        await main.hover();

        await page.mouse.wheel(0, 1200);

        await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

        const after = await header.boundingBox();
        const documentScroll = await page.evaluate(() => ({
          top: document.scrollingElement!.scrollTop,
          fits: document.documentElement.scrollWidth <= innerWidth,
          height: document.scrollingElement!.scrollHeight <= innerHeight,
        }));

        expect(after?.y).toBe(initial?.y);
        expect(after!.y).toBeGreaterThanOrEqual(0);
        expect(documentScroll).toEqual({ top: 0, fits: true, height: true });

        await main.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });

        await expect(header).toBeInViewport();

        await page.screenshot({ path: info.outputPath(`${route}-scrolled.png`), animations: 'disabled' });
      }

      await checkNavigation(page, locale, width, info);

      await expect(page).toHaveURL(`/app/${locale}/auth/sign-in`);
    });
  }
}
