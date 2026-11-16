import { expect, test, signup, logout } from './support/fixtures';

test('hybrid persistence keeps private content out of transport and reopens locked', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);

  await cdp.send('WebAuthn.enable');

  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });

  await signup(page);

  const privateMarker = 'SYNTHETIC_PRIVATE_PERSISTENCE_7c18';
  const cloudMarker = 'Synthetic server-readable operation';
  const transport: string[] = [];

  page.on('request', (request) => {
    if (request.url().includes('/api/persistence/')) {
      transport.push(request.postData() ?? '');
    }
  });

  await page.goto('/app/en/persistence');

  await page.getByRole('button', { name: 'Create a synthetic workspace', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Operational note · service-readable', exact: true })).toBeVisible();

  const workspace = page.url();

  await page.getByLabel('Operational content', { exact: true }).fill(cloudMarker);

  await page.getByRole('button', { name: 'Save operational note', exact: true }).click();

  await expect(page.getByRole('status')).toContainText(['Operational content was saved']);

  await page.getByRole('button', { name: 'Provision an empty private resource', exact: true }).click();

  await expect(page.getByLabel('Private text', { exact: true })).toBeEnabled();

  await context.setOffline(true);

  await page.getByLabel('Private text', { exact: true }).fill(privateMarker);

  await page.getByRole('button', { name: 'Save encrypted change', exact: true }).click();

  await expect(page.locator('pre')).toHaveText(privateMarker);

  await expect(page.getByText('An encrypted change is waiting for synchronization.', { exact: false })).toBeVisible();

  await context.setOffline(false);

  await page.getByRole('button', { name: 'Synchronize encrypted changes', exact: true }).click();

  await expect(page.getByLabel('Private text', { exact: true })).toBeEnabled();

  expect(transport.join('\n')).toContain(cloudMarker);
  expect(transport.join('\n')).not.toContain(privateMarker);

  await page.reload();

  await expect(page.getByLabel('Operational content', { exact: true })).toHaveValue(cloudMarker);

  await expect(page.getByText('Private resources are locked.', { exact: true })).toBeVisible();

  await expect(page.locator('pre')).toHaveCount(0);

  await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();

  await expect(page.locator('pre')).toHaveText(privateMarker);

  await page.getByRole('button', { name: 'Lock private resources', exact: true }).click();

  await expect(page.locator('pre')).toHaveCount(0);

  await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();

  await expect(page.locator('pre')).toHaveText(privateMarker);

  await page.setViewportSize({ width: 1280, height: 800 });

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await page.screenshot({
    path: test.info().outputPath('persistence-desktop-en.png'),
    fullPage: true,
    animations: 'disabled',
  });

  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(workspace.replace('/app/en/', '/app/es/'));

  await expect(page.getByRole('heading', { name: 'Ejemplo de persistencia híbrida', exact: true })).toBeVisible();

  await expect(page.getByText('Los recursos privados están bloqueados.', { exact: true })).toBeVisible();

  await expect(page.locator('pre')).toHaveCount(0);

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await page.screenshot({
    path: test.info().outputPath('persistence-mobile-es-locked.png'),
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByRole('button', { name: 'Desbloquear con passkey', exact: true }).focus();

  await page.keyboard.press('Enter');

  await expect(page.locator('pre')).toHaveText(privateMarker);

  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  expect(fits).toBe(true);

  await page.screenshot({
    path: test.info().outputPath('persistence-mobile-es.png'),
    fullPage: true,
    animations: 'disabled',
  });

  await page.goto(workspace);

  await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();

  await expect(page.locator('pre')).toHaveText(privateMarker);

  await logout(page);

  await page.goto(workspace);

  await expect(page.getByRole('heading', { name: 'Sign in to your space.', exact: true })).toBeVisible();

  await expect(page.getByText(privateMarker, { exact: true })).toHaveCount(0);
});
