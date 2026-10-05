import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { authenticateViaDeterministicTestSession, createCredentials } from '../support/auth';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`contains mobile navigation focus and releases it on Escape and desktop resize in ${colorScheme} mode`, async ({
    page,
    request,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await page.addInitScript((theme) => localStorage.setItem('themis.theme', theme), colorScheme);
    await page.setViewportSize({ width: 390, height: 844 });
    await authenticateViaDeterministicTestSession(page, request, createCredentials().email, '');
    await page.goto('/app/en/account');
    await expect(page.getByRole('heading', { name: 'Your account', level: 1 })).toBeVisible();
    await expect
      .poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark')))
      .toBe(colorScheme === 'dark');
    const opener = page.getByRole('button', { name: 'Open navigation', exact: true });
    const drawer = page.getByRole('complementary');

    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(drawer.getByRole('heading', { name: 'Navigation', exact: true })).toBeVisible();
    await expect.poll(() => drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    for (const direction of ['Tab', 'Shift+Tab']) {
      for (let step = 0; step < 20; step += 1) {
        await page.keyboard.press(direction);
        await expect.poll(() => drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      }
    }
    const openAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();

    expect(openAudit.violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`mobile-navigation-open-${colorScheme}.png`),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(drawer.getByRole('heading', { name: 'Navigation', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(drawer.getByRole('heading', { name: 'Navigation', exact: true })).toBeHidden();

    // Resizing must release the background, not merely hide the mobile title.
    const accountHeading = page.getByRole('heading', { name: 'Your account', level: 1 });

    await expect(accountHeading).toBeVisible();
    await expect.poll(() => accountHeading.evaluate((element) => element.closest('[inert]') === null)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(drawer).toBeHidden();
    await opener.focus();
    await expect(opener).toBeFocused();
    const closedAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();

    expect(closedAudit.violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`mobile-navigation-closed-${colorScheme}.png`),
      animations: 'disabled',
    });
  });
}
