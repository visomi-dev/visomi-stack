import type { Page } from '@playwright/test';
import { readMailCode } from '@visomi-stack/dev-testing';

import {
  expect,
  test,
  address,
  password,
  logout,
  expireAuthentication,
  passkeySignup,
  virtualPasskey,
} from './support/fixtures';

type RegistrationOptions = { options: { user: { id: string; name: string; displayName: string } } };

async function signInWithoutRename(page: Page) {
  const observed = await page.evaluateHandle(() => {
    let calls = 0;
    const original = PublicKeyCredential.signalCurrentUserDetails.bind(PublicKeyCredential);

    PublicKeyCredential.signalCurrentUserDetails = (details) => {
      calls++;

      return original(details);
    };

    return () => calls;
  });

  await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

  const calls = await observed.evaluate((count) => count());

  expect(calls).toBe(0);
}

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

  let complete!: (value: RegistrationOptions) => void;
  const registration = new Promise<RegistrationOptions>((resolve) => {
    complete = resolve;
  });

  // Retain the real response before automatic credential presence can navigate and evict its CDP body.
  await page.route(
    '**/api/auth/passkeys/registration/options',
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();

      complete(body);

      await route.fulfill({ response });
    },
    { times: 1 },
  );

  await page.getByRole('button', { name: 'Create account with a passkey', exact: true }).click();

  const options = await registration;

  expect(options.options.user).toMatchObject({ name: email, displayName: email });
  expect(Buffer.from(options.options.user.id, 'base64url').toString()).toMatch(/^[a-f0-9-]{36}$/);

  await expect(page.getByRole('heading', { name: 'Verify your email', exact: true })).toBeVisible();

  const code = await readMailCode(email);

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

  await logout(page);

  await signInWithoutRename(page);

  await page.goto('/app/en/security/passkeys');

  await expect(page.getByRole('heading', { name: 'Device-bound passkey', exact: true })).toBeVisible();

  await expect(page.locator('app-manage-passkeys time')).toHaveCount(2);

  await page.getByRole('button', { name: 'Rename', exact: true }).click();

  await page.getByLabel('Passkey name', { exact: true }).fill('Primary synthetic key');

  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Primary synthetic key', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Rename', exact: true }).click();

  await page.getByLabel('Passkey name', { exact: true }).fill('Cancelled synthetic name');

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Primary synthetic key', exact: true })).toBeVisible();

  await expect(page.getByLabel('Passkey name', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Remove', exact: true }).click();

  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('Keep a working sign-in method');

  await expireAuthentication(email);

  await page.goto('/app/en/security/password');

  await page.getByLabel('New password', { exact: true }).fill(password);

  await page.getByRole('button', { name: 'Save password', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Confirm your identity', exact: true })).toBeFocused();

  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Confirm with a passkey', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Password saved', exact: true })).toBeFocused();

  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);

  await page.goto('/app/en/security/passkeys');

  await page.getByRole('button', { name: 'Remove', exact: true }).click();

  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Sign-in options', exact: true })).toBeVisible();

  await cdp.detach();
});

test('sign-in preserves an existing passkey with a historical display name', async ({ page }) => {
  const { cdp, credentialIds } = await virtualPasskey(page);
  const legacyLabel = 'Historical synthetic name';

  // Model an older registration's display metadata while keeping the issued user handle and challenge.
  await page.route(
    '**/api/auth/passkeys/registration/options',
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();

      body.options.user.name = legacyLabel;
      body.options.user.displayName = legacyLabel;

      await route.fulfill({ response, json: body });
    },
    { times: 1 },
  );

  await passkeySignup(page);

  const ids = await credentialIds();

  await logout(page);

  let assertions = 0;
  let renames = 0;

  cdp.on('WebAuthn.credentialAsserted', () => assertions++);
  cdp.on('WebAuthn.credentialUpdated', ({ credential }) => {
    if (credential.userName !== legacyLabel || credential.userDisplayName !== legacyLabel) {
      renames++;
    }
  });

  await signInWithoutRename(page);

  expect(assertions).toBe(1);
  expect(renames).toBe(0);
  const remaining = await credentialIds();

  expect(remaining).toEqual(ids);

  await cdp.detach();
});
