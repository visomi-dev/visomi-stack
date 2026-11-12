import { generate } from 'otplib';
import { readMailCode } from '@visomi-stack/dev-testing';

import {
  expect,
  test,
  address,
  signup,
  logout,
  passwordStart,
  password,
  expireAuthentication,
} from './support/fixtures';

test('cancels reauthentication back to the exact device review', async ({ page }) => {
  await signup(page);

  const requestId = '11111111-1111-4111-8111-111111111111';
  const destination = '/security/devices/review?requestId=' + requestId;

  await page.route('**/api/auth/device-approval/review', (route) =>
    route.fulfill({ json: { requestId, status: 'pending', expiresAt: '2099-01-01T00:00:00.000Z' } }),
  );

  await page.goto('/app/en/auth/reauthenticate?returnTo=' + encodeURIComponent(destination));

  const cancel = page.getByRole('link', { name: 'Cancel', exact: true });

  await expect(cancel).toHaveAttribute('href', '/app/en' + destination);

  await cancel.click();

  await expect(page).toHaveURL('/app/en' + destination);

  await expect(page.getByLabel('Pairing code', { exact: true })).toBeVisible();
});

test('sets up TOTP locally and signs in with a replacement backup code', async ({ page, context }) => {
  const email = await signup(page);

  await page.goto('/app/en/security/totp');

  await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();

  const manualKey = page.locator('app-manage-totp code');

  await expect(manualKey).not.toBeEmpty();

  const secret = await manualKey.innerText();

  await expect(page.locator('app-totp-qr canvas')).toHaveJSProperty('width', 240);

  const code = await generate({ secret });

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.locator('app-backup-display li')).toHaveCount(10);

  const html = await context.request.get('/app/en/security/totp');
  const result7 = await html.text();

  expect(result7).not.toContain(secret);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));

  expect(storage).not.toContain(secret);

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

test('confirms a pending password change and saves it without another entry or submit', async ({ page }) => {
  const email = await signup(page);

  await expireAuthentication(email);

  await page.goto('/app/en/security/password');

  let mutations = 0;

  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/password/change') {
      mutations++;
    }
  });

  await page.getByLabel('New password', { exact: true }).fill('Do not retain this synthetic password!');

  await page.getByRole('button', { name: 'Save password', exact: true }).click();

  const heading = page.getByRole('heading', { name: 'Confirm your password change', exact: true });

  await expect(heading).toBeVisible();

  await expect(heading).toBeFocused();

  await expect(page).toHaveURL('/app/en/security/password');

  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);

  await page.getByLabel('Password', { exact: true }).fill(password);

  await page.getByRole('button', { name: 'Confirm with your password', exact: true }).click();

  await expect(page.getByLabel('Verification code', { exact: true })).toBeVisible();

  const code = await readMailCode(email);

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Manage password', exact: true })).toBeVisible();

  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');

  await expect(page.getByText('Your password has been saved.', { exact: true })).toBeVisible();

  expect(mutations).toBe(2);
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
  let subscribed = false;
  let disconnected = false;

  other.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/socket.io/') {
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload === 'string') {
          subscribed ||= payload.startsWith('40/session,{');
          disconnected ||= payload === '41/session,';
        }
      });
    }
  });

  try {
    await passwordStart(other, replacement);

    const factor = await readMailCode(replacement);

    await other.getByLabel('Verification code', { exact: true }).fill(factor);

    await other.getByRole('button', { name: 'Verify', exact: true }).click();

    await expect(other.getByRole('heading', { name: 'Welcome home.', exact: true })).toBeVisible();

    await expect.poll(() => subscribed).toBe(true);

    await page.goto('/app/en/security/sessions');

    await expect(page.getByRole('heading', { name: 'Other session', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'End other sessions', exact: true }).click();

    await page.getByRole('button', { name: 'Confirm', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Other session', exact: true })).toHaveCount(0);

    await expect.poll(() => disconnected).toBe(true);

    await other.reload();

    await expect(other.getByRole('heading', { name: 'Sign in to your space.', exact: true })).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test('filters return targets before redirecting to sign-in and reauthentication', async ({ page }) => {
  await page.goto('/app/en/account?code=synthetic-proof');

  await expect(page).toHaveURL('/app/en/auth/sign-in');

  await signup(page);

  await page.route('**/api/auth/email/change/request', (route) =>
    route.fulfill({ status: 403, json: { error: 'reauthentication_required' } }),
  );

  await page.goto('/app/en/account?code=synthetic-proof');

  await page.getByLabel('Email address', { exact: true }).fill(address());

  await page.getByRole('button', { name: 'Change email', exact: true }).click();

  await expect(page).toHaveURL('/app/en/auth/reauthenticate');

  await expect(page.getByRole('link', { name: 'Cancel', exact: true })).toHaveAttribute('href', '/app/en/security');
});
