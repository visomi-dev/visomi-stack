import { readMailCode } from '@visomi-stack/dev-testing';

import { expect, test, address, password, logout } from './support/fixtures';

test('registers and authenticates a real virtual passkey through the browser', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);

  await cdp.send('WebAuthn.enable');

  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  const email = address();

  await page.goto('/app/en/auth/sign-up');

  await page.getByLabel('Email address', { exact: true }).fill(email);

  await page.getByRole('button', { name: 'Create account with a passkey', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Verify your email', exact: true })).toBeVisible();

  const code = await readMailCode(email);

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await page.getByRole('button', { name: 'Verify', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Welcome home.', exact: true })).toBeVisible();

  await logout(page);

  await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Welcome home.', exact: true })).toBeVisible();

  await page.goto('/app/en/security/passkeys');

  await page.getByRole('button', { name: 'Rename', exact: true }).click();

  await page.getByLabel('Passkey name', { exact: true }).fill('Primary synthetic key');

  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Primary synthetic key', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Remove', exact: true }).click();

  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('Keep at least one working sign-in method');

  await page.goto('/app/en/security/password');

  await page.getByLabel('New password', { exact: true }).fill(password);

  await page.getByRole('button', { name: 'Save password', exact: true }).click();

  await expect(page.getByText('Your password has been saved.', { exact: true })).toBeVisible();

  await page.goto('/app/en/security/passkeys');

  await page.getByRole('button', { name: 'Remove', exact: true }).click();

  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Sign in to your space.', exact: true })).toBeVisible();

  await cdp.detach();
});
