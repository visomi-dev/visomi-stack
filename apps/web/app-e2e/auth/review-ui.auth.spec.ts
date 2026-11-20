import type { Page, TestInfo } from '@playwright/test';

import { expect, openAccount, signup, test } from './support/fixtures';

import { browserConsentKey } from '@visomi-stack/web-shared-observability';

async function capture(page: Page, info: TestInfo, filename: string) {
  if (info.project.name === 'auth-chromium') {
    await page.evaluate(() => document.fonts.ready);

    await page.screenshot({ path: info.outputPath(filename), animations: 'disabled' });
  }
}

test('keeps the continuous shell, compact navigation and nested account destinations keyboard accessible', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1680, height: 900 });

  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });

  await page.addInitScript((key) => localStorage.setItem(key, 'reject'), browserConsentKey);

  const email = await signup(page);

  const sidebar = page.locator('app-sidebar');
  const navigation = sidebar.getByRole('navigation', { name: 'Primary navigation' });
  const brand = page.getByRole('link', { name: 'Visomi Stack', exact: true });
  const panel = page.locator('[data-slot="shell-panel"]');
  const main = page.getByRole('main');
  const header = page.locator('header[app-topbar]');
  const accountTrigger = page.getByRole('button', { name: 'Account menu' });
  const account = page.locator('#workspace-account-popover');
  const privacy = sidebar.getByRole('link', { name: 'Privacy', exact: true });
  const collapse = page.getByRole('button', { name: 'Collapse sidebar' });
  const expand = page.getByRole('button', { name: 'Expand sidebar' });
  const vault = navigation.getByRole('link', { name: 'Vault example' });

  await expect(brand).toHaveCount(1);

  await expect(brand).toHaveAttribute('href', '/app/en/home');

  await expect(navigation.getByRole('link')).toHaveText(['Home', 'Cloud example', 'Vault example']);

  await expect(navigation.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

  await expect(panel).toHaveCSS('border-radius', '0px');

  await expect(panel).toHaveCSS('border-top-width', '0px');

  await expect(panel).toHaveCSS('box-shadow', 'none');

  await expect(main.getByRole('link', { name: 'Privacy', exact: true })).toHaveCount(0);

  await expect(page.getByRole('link', { name: 'Privacy', exact: true })).toHaveCount(1);

  await expect(privacy).toHaveAttribute('href', '/en/privacy/');

  const geometry = await main.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const content = element.querySelector('[data-slot="page-content"]')!.getBoundingClientRect();
    const rail = document.querySelector('app-sidebar')!.getBoundingClientRect();

    return {
      meetsRail: Math.abs(bounds.left - rail.right) < 1,
      meetsViewport: Math.abs(bounds.right - innerWidth) < 1,
      centeredContent: content.left > bounds.left && content.right < bounds.right,
      scrollable: element.scrollHeight > element.clientHeight,
    };
  });

  expect(geometry).toEqual({ meetsRail: true, meetsViewport: true, centeredContent: true, scrollable: true });

  const beforeScroll = await header.boundingBox();

  await main.evaluate((element) => element.scrollTo({ top: 350, behavior: 'instant' }));

  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const afterScroll = await header.boundingBox();
  const documentScroll = await page.evaluate(() => document.scrollingElement!.scrollTop);

  expect(afterScroll).toEqual(beforeScroll);
  expect(documentScroll).toBe(0);

  await main.evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }));

  await capture(page, info, 'shell-desktop-expanded-en.png');

  await accountTrigger.press('Enter');

  await expect(account).toBeVisible();

  await expect(accountTrigger).toHaveAccessibleDescription(email);

  await capture(page, info, 'shell-desktop-expanded-account-light-en.png');

  await page.keyboard.press('Escape');

  await expect(account).toBeHidden();

  const workspace = navigation.locator('summary');

  await workspace.press('Enter');

  await expect(vault).toBeHidden();

  await workspace.press('Enter');

  await expect(vault).toBeVisible();

  await collapse.press('Enter');

  await expect(expand).toHaveAttribute('aria-expanded', 'false');

  await expect(expand).toBeFocused();

  await expect(brand).toHaveCount(1);

  await expect(sidebar).toHaveCSS('width', '72px');

  await expect(vault).toHaveAttribute('title', 'Vault example');

  await expect(vault.getByText('Vault example')).toHaveCSS('position', 'absolute');

  await expect(vault.locator('svg')).toBeVisible();

  await capture(page, info, 'shell-desktop-compact-en.png');

  await accountTrigger.press('Enter');

  await expect(account).toBeVisible();

  await expect(account).toHaveCSS('border-top-width', '1px');

  await expect(account).not.toHaveCSS('box-shadow', 'none');

  await expect(accountTrigger).toHaveAttribute('aria-expanded', 'true');

  await expect(account.getByText(email, { exact: true })).toHaveCount(0);

  await expect(account.locator('[appUI="avatar"]')).toHaveCount(0);

  await expect(accountTrigger).toHaveAccessibleDescription(email);

  const actions = account.locator('nav > a, nav > details > summary, :scope > div > button');

  await expect(actions).toHaveText(['Account', 'Security', 'Security settings', 'Sign out']);

  await expect(actions.locator('[data-slot="icon"]')).toHaveCount(4);

  await expect(actions.filter({ hasText: 'Security settings' })).toHaveCSS('list-style-type', 'none');

  await expect(account.getByRole('button').last()).toHaveText('Sign out');

  await page.emulateMedia({ colorScheme: 'dark' });

  await capture(page, info, 'shell-desktop-compact-account-dark-en.png');

  await page.emulateMedia({ colorScheme: 'light' });

  await page.keyboard.press('Tab');

  await expect(account.getByRole('link', { name: 'Account', exact: true })).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(account).toBeHidden();

  await expect(accountTrigger).toBeFocused();

  await page.keyboard.press('Tab');

  await expect(privacy).toBeFocused();

  await expect(privacy).toHaveAttribute('title', 'Privacy');

  await expect(privacy.getByText('Privacy')).toHaveCSS('position', 'absolute');

  await openAccount(page);

  await account.locator('summary').press('Enter');

  await account.getByRole('link', { name: 'Sessions', exact: true }).click();

  await expect(page).toHaveURL(/\/security\/sessions$/);

  await expect(account).toBeHidden();

  await expect(accountTrigger).toHaveClass(/bg-zinc-200/);

  await expand.press('Enter');

  await expect(sidebar).toHaveCSS('width', '272px');

  await page.setViewportSize({ width: 390, height: 844 });

  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });

  await page.getByRole('link', { name: 'Español', exact: true }).click();

  await expect(page).toHaveURL(/\/app\/es\/security\/sessions$/);

  await expect(brand).toHaveCount(1);

  await expect(brand).toHaveAttribute('href', '/app/es/home');

  await expect(page.getByRole('button', { name: 'Contraer menú lateral' })).toHaveCount(0);

  const drawer = page.locator('#mobile-navigation');
  const menu = page.getByRole('button', { name: 'Menú', exact: true });

  await menu.press('Enter');

  await expect(drawer).toBeVisible();

  await expect(drawer.getByRole('link', { name: 'Visomi Stack' })).toBeVisible();

  await expect(page.locator('header[app-topbar] .mobile-brand')).toBeHidden();

  await expect(brand).toHaveCount(1);

  await expect(drawer).toHaveCSS('width', '390px');

  await expect(page.getByRole('link', { name: 'Privacidad', exact: true })).toHaveCount(1);

  const disclosure = drawer.locator('footer > details');
  const summary = disclosure.locator(':scope > summary');
  const accountLink = disclosure.getByRole('link', { name: 'Cuenta', exact: true });
  const mobilePrivacy = drawer.getByRole('link', { name: 'Privacidad', exact: true });
  const backgrounds = new Set<string>();

  await expect(summary).toHaveCSS('list-style-type', 'none');

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });

    await expect(accountLink).toBeHidden();

    await expect(disclosure).toHaveCSS('border-top-width', '0px');

    await expect(disclosure).toHaveCSS('box-shadow', 'none');

    const background = await drawer.evaluate((element) => getComputedStyle(element).backgroundColor);

    await expect(disclosure).not.toHaveCSS('background-color', background);

    const disclosureBackground = await disclosure.evaluate((element) => getComputedStyle(element).backgroundColor);

    backgrounds.add(disclosureBackground);

    await drawer.getByRole('link', { name: 'Ejemplo de vault' }).focus();

    await page.keyboard.press('Tab');

    await expect(summary).toBeFocused();

    await expect(summary).toHaveCSS('outline-width', '2px');

    await capture(page, info, `shell-mobile-account-${colorScheme}-closed-es.png`);

    await page.keyboard.press('Enter');

    await expect(accountLink).toBeVisible();

    await expect(disclosure).toHaveCSS('border-top-width', '0px');

    await expect(disclosure).toHaveCSS('box-shadow', 'none');

    await capture(page, info, `shell-mobile-account-${colorScheme}-open-es.png`);

    const securitySettings = drawer.getByText('Configuración de seguridad', { exact: true });

    await securitySettings.click();

    await expect(drawer.getByRole('link', { name: 'Sesiones' })).toHaveAttribute('aria-current', 'page');

    await capture(page, info, `shell-mobile-account-${colorScheme}-nested-es.png`);

    await securitySettings.click();

    await summary.focus();

    await page.keyboard.press('Enter');

    await expect(accountLink).toBeHidden();
  }

  expect(backgrounds.size).toBe(2);

  await expect(mobilePrivacy).toHaveAttribute('href', '/es/privacy/');

  await summary.focus();

  await page.keyboard.press('Tab');

  await expect(mobilePrivacy).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(drawer).toBeHidden();

  await expect(menu).toBeFocused();
});

test('changes the synthetic Home chart and its accessible table in each locale', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 900 });

  await page.emulateMedia({ colorScheme: 'light' });

  await signup(page);

  const chart = page.getByRole('img', { name: 'Checks by day' });
  const table = page.getByRole('table', { name: 'Daily totals' });
  const seven = page.getByRole('button', { name: '7 days' });

  await expect(page.getByText(/fixed, synthetic data/)).toBeVisible();

  await expect(chart).toHaveAttribute('aria-describedby', 'example-chart-summary');

  await expect(table.getByRole('row')).toHaveCount(15);

  const series = chart.locator('polyline');
  const full = await series.getAttribute('points');
  const lightStroke = await series.evaluate((element) => getComputedStyle(element).stroke);

  await page.getByRole('link', { name: 'Review security' }).focus();

  await page.keyboard.press('Tab');

  await expect(seven).toBeFocused();

  await page.keyboard.press('Enter');

  await expect(seven).toHaveAttribute('aria-pressed', 'true');

  await expect(seven).toBeFocused();

  const visibleFocus = await seven.evaluate((element) => element.matches(':focus-visible'));

  expect(visibleFocus).toBe(true);

  await expect(table.getByRole('row')).toHaveCount(8);

  await expect(series).not.toHaveAttribute('points', full!);

  await expect(page.getByRole('status').filter({ hasText: /checks over 7 days/ })).toBeVisible();

  await capture(page, info, 'dashboard-desktop-en.png');

  await page.setViewportSize({ width: 320, height: 750 });

  await page.emulateMedia({ colorScheme: 'dark' });

  await page.getByRole('link', { name: 'Español', exact: true }).click();

  await expect(page).toHaveURL(/\/app\/es\/home$/);

  await expect(page.getByRole('heading', { name: 'Tablero de ejemplo' })).toBeVisible();

  const localizedChart = page.getByRole('img', { name: 'Pruebas por día' });

  await expect(localizedChart).toBeVisible();

  await expect(localizedChart.locator('polyline')).not.toHaveCSS('stroke', lightStroke);

  const localizedTable = page.getByRole('table', { name: 'Totales por día' });

  await expect(localizedTable.getByRole('row')).toHaveCount(15);

  const fitsCard = await localizedTable.evaluate((element) => {
    const card = element.parentElement!;
    const rightEdge = card.getBoundingClientRect().right - parseFloat(getComputedStyle(card).paddingRight);

    return element.getBoundingClientRect().right <= rightEdge;
  });

  expect(fitsCard).toBe(true);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);

  expect(scrollWidth).toBeLessThanOrEqual(320);

  await page.getByRole('img', { name: 'Pruebas por día' }).scrollIntoViewIfNeeded();

  await capture(page, info, 'dashboard-mobile-es.png');
});

test('gives the shared language icon room while preserving localized links', async ({ page }) => {
  for (const path of ['/en/', '/app/en/auth/sign-in/password']) {
    await page.setViewportSize({ width: 768, height: 850 });

    await page.goto(path);

    const language = page.getByRole('navigation', { name: 'Language' });
    const icon = language.locator('svg');

    await expect(icon).toHaveCSS('width', '20px');

    await expect(icon).toHaveCSS('margin-inline-end', '8px');

    const spanish = language.getByRole('link', { name: 'Español' });

    await expect(spanish).toHaveCSS('min-height', '44px');

    await spanish.press('Enter');

    const localized = page.getByRole('navigation', { name: 'Idioma' });

    await expect(localized.getByRole('link', { name: 'English' })).toBeVisible();

    await expect(localized.locator('svg')).toHaveCSS('width', '20px');

    await page.setViewportSize({ width: 320, height: 750 });

    await expect(localized.locator('svg')).toBeHidden();

    await expect(localized.getByRole('link', { name: 'English' })).toBeVisible();
  }
});
