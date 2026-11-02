import { generate } from 'otplib';
import { readMailCode } from '@visomi-stack/dev-testing';

import { expect, test, address, signup, logout, passwordStart, password } from './support/fixtures';

test('sets up TOTP locally and signs in with a replacement backup code', async ({ page, context }) => {
  const email = await signup(page);

  await page.goto('/app/en/security/totp');

  const setupResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/totp/setup') && response.status() === 201,
  );

  await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();

  const result6 = await setupResponse;
  const result5 = await result6.json();
  const setup = result5 as { secret: string };

  await expect(page.locator('app-totp-qr canvas')).toHaveJSProperty('width', 240);

  const code = await generate({ secret: setup.secret });

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.locator('app-backup-display li')).toHaveCount(10);

  const html = await context.request.get('/app/en/security/totp');
  const result7 = await html.text();

  expect(result7).not.toContain(setup.secret);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));

  expect(storage).not.toContain(setup.secret);

  await page.goto('/app/en/security/recovery-codes');

  await page.getByRole('button', { name: 'Replace backup codes', exact: true }).click();

  await page.getByRole('button', { name: 'Confirm', exact: true }).click();

  await expect(page.locator('app-backup-display li')).toHaveCount(10);

  const backup = await page.locator('app-backup-display li').first().innerText();

  await logout(page);

  await passwordStart(page, email);

  await page.getByRole('button', { name: 'Use a backup code', exact: true }).click();

  await page.getByLabel('Verification code', { exact: true }).fill(backup);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Welcome home.', exact: true })).toBeVisible();
});

test('reauthenticates without replaying a sensitive change or retaining its password', async ({ page }) => {
  const email = await signup(page);

  await page.goto('/app/en/security/password');

  let mutations = 0;

  await page.route('**/api/auth/password/change', async (route) => {
    mutations++;

    if (mutations === 1) {
      await route.fulfill({ status: 401, json: { error: 'reauthentication_required' } });
    } else {
      await route.continue();
    }
  });

  await page.getByLabel('New password', { exact: true }).fill('Do not retain this synthetic password!');

  await page.getByRole('button', { name: 'Save password', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Confirm it is you', exact: true })).toBeVisible();

  await page.getByLabel('Password', { exact: true }).fill(password);

  await page.getByRole('button', { name: 'Use a password', exact: true }).click();

  await expect(page.getByLabel('Verification code', { exact: true })).toBeVisible();

  const code = await readMailCode(email);

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Manage password', exact: true })).toBeVisible();

  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');

  expect(mutations).toBe(1);
});

test('changes email and revokes another session from the security pages', async ({ page, browser }) => {
  await signup(page);

  const replacement = address();

  await page.goto('/app/en/account');

  await page.getByLabel('Email address', { exact: true }).fill(replacement);

  await page.getByRole('button', { name: 'Change email', exact: true }).click();

  await expect(page.getByLabel('Verification code', { exact: true })).toBeVisible();

  const code = await readMailCode(replacement);

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByText('Your email has been updated.', { exact: true })).toBeVisible();

  const otherContext = await browser.newContext({ baseURL: 'http://localhost:4204' });
  const other = await otherContext.newPage();

  try {
    await passwordStart(other, replacement);

    const factor = await readMailCode(replacement);

    await other.getByLabel('Verification code', { exact: true }).fill(factor);

    await other.getByRole('button', { name: 'Verify', exact: true }).click();

    await expect(other.getByRole('heading', { name: 'Welcome home.', exact: true })).toBeVisible();

    await page.goto('/app/en/security/sessions');

    await expect(page.getByRole('heading', { name: 'Other session', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'End other sessions', exact: true }).click();

    await page.getByRole('button', { name: 'Confirm', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Other session', exact: true })).toHaveCount(0);

    await other.reload();

    await expect(other.getByRole('heading', { name: 'Sign in to your space.', exact: true })).toBeVisible();
  } finally {
    await otherContext.close();
  }
});
