import type { Locator, Page, TestInfo } from '@playwright/test';

import { expect, signup, test } from './support/fixtures';

import { browserPrivacyCopy } from '@visomi-stack/web-shared-observability';

const desktop = { width: 1366, height: 900 };
const mobile = { width: 390, height: 844 };

const surfaces = [
  { name: 'website', path: (locale: string) => '/' + locale + '/' },
  { name: 'app', path: (locale: string) => '/app/' + locale + '/home', prepare: signup },
  { name: 'sign-in', path: (locale: string) => '/app/' + locale + '/auth/sign-in/password' },
];

const appearances = [
  { name: 'desktop-light-en', locale: 'en', colorScheme: 'light', viewport: desktop },
  { name: 'mobile-dark-es', locale: 'es', colorScheme: 'dark', viewport: mobile },
] as const;

async function capture(page: Page, info: TestInfo, name: string) {
  if (info.project.name === 'auth-chromium') {
    await page.evaluate(() => document.fonts.ready);

    await page.screenshot({ path: info.outputPath(name + '.png'), animations: 'disabled' });
  }
}

async function verifyPlacement(card: Locator, viewport: typeof desktop) {
  const pinned = viewport === desktop;

  await expect(card).toHaveCSS('position', pinned ? 'fixed' : 'static');

  if (pinned) {
    await expect(card).toBeInViewport({ ratio: 1 });

    const box = await card.boundingBox();

    expect(box?.x).toBe(16);
    expect(box?.y).toBeGreaterThan(desktop.height * 0.7);
    expect(box?.width).toBeLessThanOrEqual(320);
  }
}

async function captureAfterScroll(page: Page, card: Locator, info: TestInfo, name: string, viewport: typeof mobile) {
  if (viewport === mobile) {
    await card.scrollIntoViewIfNeeded();

    await expect(card).toBeInViewport({ ratio: 1 });

    await capture(page, info, name + '-card');
  }
}

for (const surface of surfaces) {
  test('places the localized consent card on ' + surface.name, async ({ page }, info) => {
    await surface.prepare?.(page);

    for (const appearance of appearances) {
      await page.setViewportSize(appearance.viewport);

      await page.emulateMedia({ colorScheme: appearance.colorScheme });

      await page.goto(surface.path(appearance.locale));

      const main = page.getByRole('main');
      const copy = browserPrivacyCopy[appearance.locale];
      const card = page.getByRole('region', { name: copy.title });
      const left = card.getByRole('button', { name: copy.reject, exact: true });
      const right = card.getByRole('button', { name: copy.accept, exact: true });
      const purpose = card.getByRole('link', { name: copy.purposeLink });
      const captureName = surface.name + '-' + appearance.name;

      await expect(main.getByRole('heading', { level: 1 })).toBeVisible();

      await expect(card).toBeVisible();

      await expect(page.getByRole('dialog')).toHaveCount(0);

      await expect(card.locator(':focus')).toHaveCount(0);

      await expect(purpose).toHaveAttribute('href', '/' + appearance.locale + '/privacy/');

      await verifyPlacement(card, appearance.viewport);

      await capture(page, info, captureName);

      await captureAfterScroll(page, card, info, captureName, appearance.viewport);

      const first = await left.boundingBox();
      const second = await right.boundingBox();

      expect(first?.width).toBeGreaterThan(0);
      expect(second).toMatchObject({ y: first?.y, width: first?.width, height: first?.height });
    }
  });
}

test('keeps narrow sign-in controls usable and provides a place for the card below the form', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 280, height: 520 });

  await page.emulateMedia({ colorScheme: 'dark' });

  await page.goto('/app/es/auth/sign-in/password');

  const copy = browserPrivacyCopy.es;
  const card = page.getByRole('region', { name: copy.title });
  const email = page.locator('#password-email');
  const password = page.locator('#account-password');
  const submit = page.locator('form button[type="submit"]');

  await expect(card).toHaveCSS('position', 'static');

  await email.focus();

  await page.keyboard.press('Tab');

  await expect(password).toBeFocused();

  // Emulate a shorter visible area while keeping focus in the form.
  await page.setViewportSize({ width: 280, height: 360 });

  await expect(password).toBeFocused();

  await password.scrollIntoViewIfNeeded();

  await expect(password).toBeInViewport({ ratio: 1 });

  await expect(card).not.toBeInViewport();

  await capture(page, info, 'sign-in-narrow-dark-es-focus');

  await submit.scrollIntoViewIfNeeded();

  await expect(submit).toBeInViewport({ ratio: 1 });

  await expect(card).toHaveCSS('position', 'static');

  const left = card.getByRole('button', { name: copy.reject, exact: true });
  const right = card.getByRole('button', { name: copy.accept, exact: true });

  await left.focus();

  await page.keyboard.press('Tab');

  await expect(right).toBeFocused();

  const [first, second] = await card
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON()));

  expect(first.height).toBe(second.height);
  expect(first.width).toBe(second.width);
  expect(first.bottom).toBeLessThan(second.top);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);

  expect(scrollWidth).toBeLessThanOrEqual(280);

  await page.keyboard.press('Tab');

  await expect(card.getByRole('link', { name: copy.purposeLink })).toBeFocused();

  await page.keyboard.press('Tab');

  await expect(page.getByRole('contentinfo').getByRole('link', { name: copy.privacy })).toBeFocused();
});

test('lets desktop keyboard focus reach the page behind the card', async ({ page }) => {
  await page.setViewportSize(desktop);

  await page.goto('/en/');

  const copy = browserPrivacyCopy.en;
  const card = page.getByRole('region', { name: copy.title });
  const privacy = page.getByRole('contentinfo').getByRole('link', { name: copy.privacy });

  await expect(card).toHaveCSS('position', 'fixed');

  await page.keyboard.press('Tab');

  await privacy.focus();

  await expect(privacy).toBeFocused();

  await expect(privacy).toBeInViewport({ ratio: 1 });

  await expect(card).toHaveCSS('opacity', '0');

  await card.getByRole('button', { name: copy.reject, exact: true }).focus();

  await expect(card).toHaveCSS('opacity', '1');
});
