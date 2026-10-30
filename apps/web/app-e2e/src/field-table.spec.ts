import { expect, test } from '@playwright/test';

for (const locale of ['en', 'es']) {
  test(`Signal Forms field state and mobile table survive SSR/hydration in ${locale}`, async ({
    page,
    request,
  }, info) => {
    const path = `/app/${locale}/`;
    const response = await request.get(path);
    const html = await response.text();

    expect(html).toContain('<app-field');
    expect(html).toContain('for="angular-email"');
    expect(html).toContain('aria-describedby="angular-email-error"');
    expect(html).toContain('id="angular-email-error"');
    expect(html).toContain('data-control');
    expect(html).toContain('data-slot="error"');
    expect(html).toContain('role="table"');
    expect(html).not.toContain('ngskiphydration');
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(path);

    await expect(page.locator('app-root')).not.toHaveAttribute('ngh');

    const input = page.locator('#angular-email');
    const error = page.locator('#angular-email-error');
    const example = page.locator('[data-field-example]');
    const outside = example.getByRole('heading');

    await expect(error).toBeHidden();

    await input.fill('invalid-example');

    await expect(error).toBeHidden();

    await outside.click();

    await expect(error).toBeVisible();

    await input.focus();

    await expect(error).toBeHidden();

    await input.fill('demo@example.test');

    await outside.click();

    await expect(error).toBeHidden();

    await example.getByRole('button', { name: locale === 'es' ? 'Mostrar error manual' : 'Show manual error' }).click();

    await expect(error).toContainText(locale === 'es' ? 'no está disponible' : 'is unavailable');

    await expect(error).toBeVisible();

    await expect(input).toHaveAttribute('aria-invalid', 'true');

    await example.getByRole('button', { name: locale === 'es' ? 'Reiniciar ejemplo' : 'Reset example' }).click();

    await expect(error).toBeHidden();

    await example.getByRole('button', { name: locale === 'es' ? 'Comprobar ejemplo' : 'Check example' }).click();

    await expect(error).toBeVisible();

    await page.emulateMedia({ reducedMotion: 'reduce' });

    await expect(error).toHaveCSS('transition-property', 'none');

    const table = page.locator('[data-responsive-table] table');

    await expect(table.locator('tbody tr').first()).toHaveCSS('display', 'table-row');

    await page.setViewportSize({ width: 360, height: 800 });

    await expect(table.locator('tbody tr').first()).toHaveCSS('display', 'grid');

    await expect(table.locator('[data-slot=label]').first()).toBeVisible();

    await expect(table.getByRole('columnheader')).toHaveCount(2);

    await table.screenshot({ path: info.outputPath(`angular-${locale}-mobile-cards.png`), animations: 'disabled' });

    expect(errors).toEqual([]);
  });
}
