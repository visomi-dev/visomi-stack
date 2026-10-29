import { expect, test } from '@playwright/test';

for (const locale of ['en', 'es']) {
  test(`the ${locale} catalog renders all recipes through Express SSR`, async ({ page, request }) => {
    const response = await request.get(`/${locale}/ui/`);
    const html = await response.text();

    expect(response.status()).toBe(200);
    expect(html).toContain(`<html lang="${locale}"`);
    expect(html.match(/data-component=/g)).toHaveLength(32);
    expect(html).toContain('aria-describedby="input-email-help input-email-error"');
    expect(html).not.toContain('astro-island');
    expect(html).not.toContain('ng-version');
    expect(response.headers()['content-security-policy']).not.toContain('unsafe-inline');
    const errors: string[] = [];
    let scriptBytes = 0;
    const scripts: Promise<void>[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('response', (resource) => {
      if (resource.request().resourceType() === 'script') {
        scripts.push(
          resource.body().then((body) => {
            scriptBytes += body.length;
          }),
        );
      }
    });

    await page.goto(`/${locale}/ui/`);

    await expect(page.locator('[data-component]')).toHaveCount(32);

    await expect(page.locator('[data-ui-dialog-open]')).toBeEnabled();

    await Promise.all(scripts);

    expect(scripts).toHaveLength(2);
    expect(scriptBytes).toBeLessThan(6144);
    expect(errors).toEqual([]);
  });
}

test('native fields and disclosures work without JavaScript', async ({ browser }, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: info.project.use.baseURL });

  try {
    const page = await context.newPage();

    await page.goto('/en/ui/');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.locator('#checkbox').getByRole('checkbox', { name: 'Receive example updates' }).uncheck();

    await expect(
      page.locator('#checkbox').getByRole('checkbox', { name: 'Receive example updates' }),
    ).not.toBeChecked();

    await page.locator('#radio').getByRole('radio', { name: 'Shared', exact: true }).check();

    await expect(page.locator('#radio').getByRole('radio', { name: 'Personal', exact: true })).not.toBeChecked();

    await page.getByRole('switch').uncheck();

    await expect(page.getByRole('switch')).not.toBeChecked();

    await page.getByLabel('Region', { exact: true }).selectOption('eu');

    await expect(page.getByLabel('Region', { exact: true })).toHaveValue('eu');

    await page.getByText('What is shared between applications?', { exact: true }).click();

    await expect(page.locator('#disclosure [data-preview] details')).toHaveAttribute('open', '');

    await expect(page.locator('[data-ui-dialog-open]')).toBeDisabled();
  } finally {
    await context.close();
  }
});

test('generated CSS styles native groups, selected cards and switch states', async ({ page }) => {
  await page.goto('/en/ui/');

  await expect(page.locator('#amount-example')).toHaveCSS('padding-left', '36px');

  await expect(page.locator('#amount-example')).toHaveCSS('padding-right', '48px');

  const selectedCard = page.locator('#radio-card [data-preview] label').first();
  const initialBorder = await selectedCard.evaluate((element) => getComputedStyle(element).borderColor);

  await page.locator('#radio-card').getByRole('radio').last().check();

  const unselectedBorder = await selectedCard.evaluate((element) => getComputedStyle(element).borderColor);

  expect(initialBorder).not.toBe(unselectedBorder);
  const toggle = page.getByRole('switch');
  const checkedTrack = await toggle.evaluate((element) => getComputedStyle(element).backgroundColor);

  await toggle.uncheck();

  const uncheckedTrack = await toggle.evaluate((element) => getComputedStyle(element).backgroundColor);

  expect(checkedTrack).not.toBe(uncheckedTrack);

  await page.emulateMedia({ forcedColors: 'active' });

  await expect(toggle).toHaveCSS('appearance', 'auto');

  const thumbDisplay = await toggle.evaluate((element) => getComputedStyle(element, '::before').display);

  expect(thumbDisplay).toBe('none');
});

test('dialog uses native modal focus, Escape and form closing', async ({ page }) => {
  await page.goto('/en/ui/');

  const trigger = page.getByRole('button', { name: 'Open example dialog' });
  const dialog = page.getByRole('dialog', { name: 'Review the example' });
  const close = dialog.getByRole('button', { name: 'Close dialog' });

  await expect(dialog).not.toBeVisible();

  await trigger.click();

  await expect(dialog).toBeVisible();

  await expect(close).toBeFocused();

  // A modal must reject focus attempts on background controls.
  await trigger.evaluate((element) => element.focus());

  await expect(close).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(dialog).not.toBeVisible();

  await expect(trigger).toBeFocused();

  await trigger.click();

  await close.click();

  await expect(dialog).not.toBeVisible();

  await expect(trigger).toBeFocused();
});

test('local validation associates errors without sending data', async ({ page }) => {
  await page.goto('/en/ui/');

  const input = page.locator('#input-email');
  const error = page.locator('#input-email-error');

  await input.fill('invalid-example');

  await page.getByRole('button', { name: 'Check example fields' }).click();

  await expect(input).toHaveAttribute('aria-invalid', 'true');

  await expect(error).toBeVisible();

  await expect(input).toBeFocused();

  await expect(page.locator('[data-ui-validation-status]')).toHaveText('Review the highlighted example field.');

  await input.fill('demo@example.test');

  await page.getByRole('button', { name: 'Check example fields' }).click();

  await expect(error).not.toBeVisible();

  await expect(input).toHaveAttribute('aria-invalid', 'false');

  await expect(page.locator('[data-ui-validation-status]')).toHaveText('The example fields are valid.');

  await expect(page).toHaveURL(/\/en\/ui\/$/);
});

for (const width of [360, 1280]) {
  for (const theme of ['light', 'dark']) {
    test(`catalog layout at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 850 });

      await page.emulateMedia({ reducedMotion: 'reduce' });

      await page.goto('/es/ui/');

      await page.locator('[data-theme-select]').selectOption(theme);

      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? 'dark' : '');

      await page.evaluate(() => document.fonts.ready);

      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

      expect(fits).toBe(true);

      await expect(page.locator('#loader [aria-hidden]')).toHaveCSS('animation-name', 'none');

      await page.screenshot({ path: info.outputPath('catalog.png'), animations: 'disabled' });

      await page.locator('#input').scrollIntoViewIfNeeded();

      await expect(page.locator('#input-email')).toHaveCSS('min-height', '44px');

      await page.screenshot({ path: info.outputPath('inputs.png'), animations: 'disabled' });

      await page.locator('#button').getByText('Ver uso', { exact: true }).click();

      const expandedFits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

      expect(expandedFits).toBe(true);
    });
  }
}
