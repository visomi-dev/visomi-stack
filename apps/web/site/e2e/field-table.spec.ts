import { expect, test } from '@playwright/test';

test('field errors reveal after blur and submission, collapse while editing, and reset when valid', async ({
  page,
}) => {
  await page.goto('/en/ui/');

  const input = page.locator('#input-email');
  const error = page.locator('#input-email-error');
  const outside = page.locator('#input h3');

  await expect(error).toBeHidden();

  await expect.poll(() => error.evaluate((element) => element.getBoundingClientRect().height)).toBe(0);

  await input.fill('invalid-example');

  await expect(error).toBeHidden();

  await outside.click();

  await expect(error).toBeVisible();

  await expect(error).toHaveCSS('transition-duration', '0.2s');

  await input.focus();

  await expect(error).toBeHidden();

  await input.fill('');

  await outside.click();

  await expect(error).toBeHidden();

  await page.getByRole('button', { name: 'Check example fields' }).click();

  await outside.click();

  await expect(error).toBeVisible();

  await input.fill('demo@example.test');

  await outside.click();

  await expect(error).toBeHidden();
});

test('error expansion has no fixed height cap and reduced motion removes its transition', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });

  await page.goto('/en/ui/');

  const error = page.locator('#email-error');

  await error.locator('span').evaluate((element) => {
    element.textContent = 'Synthetic validation message that wraps on a narrow viewport. '.repeat(12);
  });

  await expect(error).toBeVisible();

  await expect.poll(() => error.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(96);

  const contentFits = await error.evaluate((element) => element.scrollHeight <= element.clientHeight + 1);

  expect(contentFits).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });

  await expect(error).toHaveCSS('transition-property', 'none');

  await error.locator('span').evaluate((element) => {
    element.textContent = '';
  });

  await expect(error).toBeHidden();
});

test('responsive table keeps headers and cell associations when changing to mobile cards', async ({ page }, info) => {
  await page.goto('/en/ui/');

  const table = page.locator('#table table');
  const rows = table.locator('tbody tr');
  const labels = table.locator('[data-slot=label]');

  await expect(rows.first()).toHaveCSS('display', 'table-row');

  await expect(labels.first()).toBeHidden();

  await expect(table.getByRole('columnheader')).toHaveCount(2);

  await expect(table.getByRole('columnheader').first()).toHaveCSS('position', 'sticky');

  await page.setViewportSize({ width: 360, height: 800 });

  await expect(rows.first()).toHaveCSS('display', 'grid');

  await expect(labels.first()).toBeVisible();

  await expect(table.getByRole('columnheader')).toHaveCount(2);

  await expect(table.getByRole('rowheader')).toHaveCount(2);

  await expect(table.getByRole('cell').first()).toHaveAttribute('headers', 'docs-status docs-studio');

  await expect(table.getByRole('columnheader').first()).toHaveCSS('position', 'static');

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  expect(fits).toBe(true);

  await table.screenshot({ path: info.outputPath('mobile-cards.png'), animations: 'disabled' });

  await page.setViewportSize({ width: 1280, height: 850 });

  await expect(rows.first()).toHaveCSS('display', 'table-row');

  await expect(labels.first()).toBeHidden();

  await table.locator('tbody').evaluate((body) => {
    const first = body.querySelector('tr');

    if (!first) {
      throw new Error('synthetic_row_missing');
    }

    for (let index = 0; index < 12; index++) {
      const row = first.cloneNode(true) as HTMLElement;
      const header = row.querySelector('th');

      if (header) {
        header.id = 'synthetic-workspace-' + index;
      }

      row.querySelector('td')?.setAttribute('headers', 'docs-status synthetic-workspace-' + index);
      body.append(row);
    }
  });

  await page.locator('[data-table-scroll]').evaluate((element) => {
    element.scrollTop = 200;
  });

  await expect
    .poll(() =>
      table
        .getByRole('columnheader')
        .first()
        .evaluate((header) => {
          const container = header.closest('[data-table-scroll]');

          return container
            ? Math.abs(header.getBoundingClientRect().top - container.getBoundingClientRect().top)
            : Number.POSITIVE_INFINITY;
        }),
    )
    .toBeLessThan(2);
});

test('field validation and mobile cards work with JavaScript disabled', async ({ browser }, info) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 360, height: 800 },
    baseURL: info.project.use.baseURL,
  });

  try {
    const page = await context.newPage();

    await page.goto('/en/ui/');

    await page.locator('#input-email').fill('invalid-example');

    await page.locator('#input h3').click();

    await expect(page.locator('#input-email-error')).toBeVisible();

    await expect(page.locator('#table tbody tr').first()).toHaveCSS('display', 'grid');

    await expect(page.locator('#table [data-slot=label]').first()).toBeVisible();
  } finally {
    await context.close();
  }
});
