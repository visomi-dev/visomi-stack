import type { Locator } from '@playwright/test';

import { expect, test, address, signup } from './support/fixtures';
import { expectCenteredDigits } from './support/pin-layout';

async function expectPinLayout(widget: Locator): Promise<void> {
  await widget.scrollIntoViewIfNeeded();

  const layout = await widget.evaluate((element) => {
    const { left, right, top, height } = element.getBoundingClientRect();
    const field = element.closest('app-field')!;
    const fieldStyle = getComputedStyle(field);
    const availableWidth = field.clientWidth - parseFloat(fieldStyle.paddingLeft) - parseFloat(fieldStyle.paddingRight);
    const slots = Array.from(element.querySelectorAll('.slot'), (slot) => slot.getBoundingClientRect());
    const control = element.querySelector('input');

    return {
      widthDifference: Math.abs(parseFloat(getComputedStyle(element).width) - availableWidth),
      slotWidthDifference: Math.max(...slots.map((slot) => slot.width)) - Math.min(...slots.map((slot) => slot.width)),
      firstInset: Math.abs(slots[0].left - left),
      lastInset: Math.abs(right - slots[slots.length - 1].right),
      right,
      viewport: window.innerWidth,
      fieldOverflow: field.scrollWidth - field.clientWidth,
      reachesLastSlot: document.elementFromPoint(right - 1, top + height / 2) === control,
      hitsOutside: document.elementFromPoint(right + 1, top + height / 2) === control,
    };
  });

  expect(layout.widthDifference).toBeLessThanOrEqual(1);
  expect(layout.slotWidthDifference).toBeLessThanOrEqual(1);
  expect(layout.firstInset).toBeLessThanOrEqual(1);
  expect(layout.lastInset).toBeLessThanOrEqual(1);
  expect(layout.right).toBeLessThanOrEqual(layout.viewport);
  expect(layout.fieldOverflow).toBeLessThanOrEqual(1);
  expect(layout.reachesLastSlot).toBe(true);
  expect(layout.hitsOutside).toBe(false);
}

for (const locale of ['en', 'es']) {
  const spanish = locale === 'es';

  test(`${locale} email change code keeps native editing and explicit submission`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });

    await page.emulateMedia({ colorScheme: spanish ? 'dark' : 'light' });

    await signup(page);

    await page.goto(`/app/${locale}/account`);

    await page.locator('app-email-entry input[type="email"]').fill(address());

    await page.locator('app-email-entry button[type="submit"]').click();

    const code = page.getByRole('textbox', { name: spanish ? 'Código de verificación' : 'Verification code' });
    const verify = page.getByRole('button', { name: spanish ? 'Verificar' : 'Verify', exact: true });
    const error = page.locator('#verification-code-error');
    const slots = page.locator('app-pin-input .slot');
    const widget = page.locator('app-pin-input > div');

    await expect(code).toBeEnabled();

    await expect(code).toHaveAccessibleDescription(spanish ? '6 dígitos' : '6 digits');

    await expect(code).toHaveAttribute('inputmode', 'numeric');

    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');

    await expect(slots).toHaveCount(6);

    await verify.click();

    await expect(code).toBeFocused();

    await expect(code).toHaveAttribute('aria-invalid', 'true');

    await expect(error).toBeVisible();

    await expect(code).toHaveAccessibleDescription(
      spanish ? '6 dígitos Completa este campo.' : '6 digits Complete this field.',
    );

    let submitted: unknown;

    await page.route('**/api/auth/email/change/verify', (route) => {
      submitted = route.request().postDataJSON().code;

      return route.fulfill({ status: 400, json: { error: 'invalid_credentials' } });
    });

    await page.evaluate(() => {
      const source = document.createElement('textarea');

      source.id = 'synthetic-code-clipboard';
      source.value = '00 12-34';
      document.body.append(source);
    });

    const source = page.locator('#synthetic-code-clipboard');

    await source.press('ControlOrMeta+a');

    await source.press('ControlOrMeta+c');

    await source.evaluate((element) => element.remove());

    await code.fill('999999');

    await code.press('ControlOrMeta+a');

    await code.press('ControlOrMeta+v');

    await expect(code).toHaveValue('001234');

    expect(submitted).toBeUndefined();

    await code.press('ControlOrMeta+a');

    await code.press('Backspace');

    await code.pressSequentially('001234');

    await expectPinLayout(widget);

    await expectCenteredDigits(widget);

    const field = page.locator('app-field').filter({ has: widget });
    const previousWidth = await field.evaluate((element: HTMLElement) => {
      const width = element.style.inlineSize;

      element.style.inlineSize = '127px';

      return width;
    });

    try {
      await expectPinLayout(widget);

      await expectCenteredDigits(widget);
    } finally {
      await field.evaluate((element: HTMLElement, width) => (element.style.inlineSize = width), previousWidth);
    }

    await code.press('ControlOrMeta+a');

    await code.press('ControlOrMeta+c');

    await code.press('Backspace');

    await expect(code).toHaveValue('');

    await code.press('ControlOrMeta+v');

    await expect(code).toHaveValue('001234');

    await code.press('ArrowLeft');

    await code.press('Shift+ArrowLeft');

    await code.press('7');

    await expect(code).toHaveValue('001274');

    await code.press('Backspace');

    await expect(code).toHaveValue('00124');

    await code.press('7');

    await code.press('Tab');

    await expect(code).toHaveValue('001274');

    await expect(verify).toBeFocused();

    await expect(code).not.toHaveAttribute('aria-invalid', 'true');

    await expect(code).toHaveAccessibleDescription(spanish ? '6 dígitos' : '6 digits');

    await verify.press('Shift+Tab');

    await expect(code).toBeFocused();

    await expect(widget).toHaveCSS('outline-style', 'solid');

    await code.press('End');

    await page.setViewportSize({ width: 1024, height: 700 });

    await expectPinLayout(widget);

    await expectCenteredDigits(widget);

    // 640 physical CSS pixels at 200% CSS zoom approximate a 320px layout viewport.
    await page.setViewportSize({ width: 640, height: 700 });

    await page.evaluate(() => (document.documentElement.style.zoom = '2'));

    const rightmostSlotFits = await slots
      .last()
      .evaluate((slot) => slot.getBoundingClientRect().right <= window.innerWidth);

    expect(rightmostSlotFits).toBe(true);

    await expectPinLayout(widget);

    expect(submitted).toBeUndefined();

    await verify.click();

    await expect(page.getByRole('alert')).toBeVisible();

    expect(submitted).toBe('001274');

    await expect(code).toHaveValue('');

    await expect(error).toBeHidden();
  });
}
