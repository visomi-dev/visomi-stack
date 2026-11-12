import type { Page, TestInfo } from '@playwright/test';

import { expect, test, signup } from './support/fixtures';

async function checkMobilePosition(page: Page, width: number): Promise<void> {
  if (width >= 1024) {
    return;
  }

  const bounds = await page.locator('nav[appUI="navbar"]').boundingBox();
  const height = await page.evaluate(() => innerHeight);

  expect(Math.round(bounds!.y + bounds!.height)).toBe(height);
}

async function checkMobileViewport(page: Page, width: number, route: string): Promise<void> {
  if (width >= 1024 || route !== 'home') {
    return;
  }

  const height = width === 844 ? 390 : 844;
  const navbar = page.locator('nav[appUI="navbar"]');

  for (const visibleHeight of [height, height - 120, height]) {
    await page.setViewportSize({ width, height: visibleHeight });

    await checkMobilePosition(page, width);

    const bounds = await navbar.boundingBox();

    await navbar.hover();

    await page.mouse.wheel(0, 600);

    await expect.poll(() => page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);

    const after = await navbar.boundingBox();

    expect(after?.y).toBe(bounds?.y);
  }
}

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

        await checkMobileViewport(page, width, route);

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

        await checkMobilePosition(page, width);

        await main.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });

        await expect(header).toBeInViewport();

        await page.screenshot({ path: info.outputPath(`${route}-scrolled.png`), animations: 'disabled' });
      }

      await checkNavigation(page, locale, width, info);

      await expect(page).toHaveURL(`/app/${locale}/auth/sign-in`);

      await page.setViewportSize({ width, height: 390 });

      await page.goto(`/app/${locale}/auth/sign-up/password`);

      await page.mouse.move(width / 2, 200);

      await page.mouse.wheel(0, 1200);

      await expect.poll(() => page.evaluate(() => document.scrollingElement!.scrollTop)).toBeGreaterThan(0);
    });
  }
}
