import { expect, signup, test } from './support/fixtures';

test('opens the last authenticated navigation item and unlocks the isolated synthetic sample', async ({
  page,
}, info) => {
  const persistence: string[] = [];

  await page.setViewportSize({ width: 1366, height: 1024 });

  await page.emulateMedia({ colorScheme: 'light' });

  await page.route('**/api/persistence/**', async (route) => {
    persistence.push('technical persistence request');

    await route.fulfill({ status: 404 });
  });

  await page.goto('/app/en/vault');

  await expect(page).toHaveURL(/\/auth\/sign-in/);

  await signup(page);

  const sidebar = page.locator('app-sidebar');
  const desktop = sidebar.getByRole('link', { name: 'Vault', exact: true });

  await expect(sidebar.getByRole('link').last()).toHaveText('Vault');

  await desktop.click();

  await expect(page).toHaveURL(/\/vault$/);

  await expect(page.getByRole('heading', { name: 'Vault', level: 1 })).toBeVisible();

  const setup = page.getByRole('button', { name: 'Set up the example vault' });
  const pin = page.getByLabel('Local unlock PIN', { exact: true });

  await expect(setup).toBeVisible();

  await page.screenshot({ path: info.outputPath('vault-desktop-initial.png'), animations: 'disabled' });

  await pin.fill('048261');

  await page.getByLabel('Confirm PIN for initial setup').fill('048261');

  await setup.click();

  const read = page.getByRole('button', { name: 'Read encrypted sample' });
  const sample = page.getByText('Synthetic note: Garden workshop starts at 10:00.');

  await read.click();

  await expect(sample).toBeVisible();

  await page.reload();

  await expect(setup).toHaveCount(0);

  await expect(sample).toHaveCount(0);

  await expect(read).toHaveCount(0);

  await pin.fill('048261');

  await page.getByRole('button', { name: 'Unlock locally with PIN' }).click();

  await read.click();

  await expect(sample).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });

  await page.emulateMedia({ colorScheme: 'dark' });

  await page.getByRole('button', { name: 'Menu', exact: true }).click();

  const menu = page.getByRole('dialog', { name: 'Primary navigation' });

  await expect(menu.getByRole('link').last()).toHaveText('Vault');

  await page.screenshot({ path: info.outputPath('vault-mobile-menu-dark.png'), animations: 'disabled' });

  await menu.getByRole('link', { name: 'Vault' }).click();

  await expect(menu).toBeHidden();

  expect(persistence).toEqual([]);
});
