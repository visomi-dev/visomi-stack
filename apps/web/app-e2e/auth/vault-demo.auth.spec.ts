import { expect, signup, test } from './support/fixtures';

test('opens the last authenticated navigation item and unlocks the isolated synthetic sample', async ({
  page,
}, info) => {
  const persistence: string[] = [];

  await page.addInitScript(() => Object.defineProperty(navigator, 'credentials', { value: undefined }));

  await page.setViewportSize({ width: 1366, height: 1024 });

  await page.emulateMedia({ colorScheme: 'light' });

  await page.route('**/api/persistence/**', async (route) => {
    persistence.push('technical persistence request');

    await route.fulfill({ status: 404 });
  });

  await page.goto('/app/en/vault-example');

  await expect(page).toHaveURL(/\/auth\/sign-in/);

  await signup(page);

  const sidebar = page.locator('app-sidebar');
  const desktop = sidebar.getByRole('link', { name: 'Vault example', exact: true });

  await expect(sidebar.getByRole('link').last()).toHaveText('Vault example');

  await desktop.click();

  await expect(page).toHaveURL(/\/vault-example$/);

  await expect(page.getByRole('heading', { name: 'Vault example', level: 1 })).toBeVisible();

  const setup = page.getByRole('button', { name: 'Set up the example vault' });
  const pin = page.getByLabel('Local unlock PIN', { exact: true });

  await expect(setup).toBeVisible();

  await expect(page.getByText('Passkey unlock isn’t available on this device.', { exact: false })).toBeVisible();

  const card = page.locator('app-vault-demo > section');
  const visibleWidth = await card.evaluate((section) => {
    const box = section.getBoundingClientRect();
    const main = section.closest('main')!.getBoundingClientRect();
    const input = section.querySelector('app-pin-input')!.getBoundingClientRect();
    const innerWidth = section.querySelector('app-vault-panel section')!.getBoundingClientRect().width;

    return {
      width: box.width,
      centerDifference: Math.abs((box.left + box.right - main.left - main.right) / 2),
      input: input.width,
      innerWidth,
    };
  });

  expect(visibleWidth.width).toBeLessThanOrEqual(576);
  expect(visibleWidth.centerDifference).toBeLessThanOrEqual(2);
  expect(visibleWidth.input).toBe(visibleWidth.innerWidth);

  await expect(card.locator('app-pin-input').first().locator('.slot')).toHaveCount(6);

  await page.screenshot({ path: info.outputPath('vault-desktop-initial.png'), animations: 'disabled' });

  await pin.fill('048261');

  await page.getByLabel('Confirm your new PIN').fill('048261');

  await setup.click();

  const read = page.getByRole('button', { name: 'Open the example note' });
  const sample = page.getByText('Sample note: Garden workshop at 10:00.');

  await read.click();

  await expect(sample).toBeVisible();

  await page.reload();

  await expect(setup).toHaveCount(0);

  await expect(sample).toHaveCount(0);

  await expect(read).toHaveCount(0);

  await pin.fill('048261');

  await page.getByRole('button', { name: 'Unlock with PIN' }).click();

  await read.click();

  await expect(sample).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });

  await page.emulateMedia({ colorScheme: 'dark' });

  await page.getByRole('button', { name: 'Menu', exact: true }).click();

  const menu = page.getByRole('dialog', { name: 'Primary navigation' });

  await expect(menu.getByRole('link').last()).toHaveText('Vault example');

  await page.screenshot({ path: info.outputPath('vault-mobile-menu-dark.png'), animations: 'disabled' });

  await menu.getByRole('link', { name: 'Vault example' }).click();

  await expect(menu).toBeHidden();

  await page.getByRole('link', { name: 'Español', exact: true }).click();

  await expect(page).toHaveURL(/\/app\/es\/vault-example$/);

  await expect(page.getByRole('heading', { name: 'Ejemplo de vault', level: 1 })).toBeVisible();

  await expect(page.locator('app-vault-demo app-pin-input')).toBeVisible();

  await expect(page.getByText(/se quedan en este navegador/)).toBeVisible();

  await expect(page.getByText(/no permite desbloquear con una clave de acceso/)).toHaveCount(0);

  const mobilePin = page.locator('app-vault-demo app-pin-input');

  await mobilePin.scrollIntoViewIfNeeded();

  await expect(mobilePin).toBeInViewport({ ratio: 1 });

  await page.screenshot({ path: info.outputPath('vault-mobile-dark-es.png'), animations: 'disabled' });

  await page.getByRole('button', { name: 'Menú', exact: true }).click();

  const localized = page.getByRole('dialog', { name: 'Navegación principal' });

  await expect(localized.getByRole('link').last()).toHaveText('Ejemplo de vault');

  expect(persistence).toEqual([]);
});
