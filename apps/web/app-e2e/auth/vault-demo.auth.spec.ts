import type { Page } from '@playwright/test';
import { readMailCode } from '@visomi-stack/dev-testing';

import { expect, logout, password, signup, passwordStart, test } from './support/fixtures';

async function virtualPasskey(page: Page) {
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
      hasPrf: true,
    },
  });

  return cdp;
}

test('opens the Vault navigation item without offering a separate vault when the API is unavailable', async ({
  page,
}) => {
  await page.route('**/api/example/{vault,cloud}/policy', (route) => route.fulfill({ status: 404 }));

  await page.goto('/app/en/example/vault');

  await expect(page).toHaveURL(/\/auth\/sign-in/);

  await signup(page);

  const primary = page.locator('app-sidebar').getByRole('navigation', { name: 'Primary navigation' });

  await expect(primary.getByRole('link').last()).toHaveText('Vault example');

  await expect(primary.getByRole('link', { name: 'Cloud example', exact: true })).toHaveCount(0);

  await primary.getByRole('link', { name: 'Vault example', exact: true }).click();

  await expect(page).toHaveURL(/\/example\/vault$/);

  await expect(page.getByRole('heading', { name: 'Vault example', level: 1 })).toBeVisible();

  await expect(
    page.getByRole('status').filter({ hasText: 'The Vault backup service is unavailable right now.' }),
  ).toBeVisible();

  await expect(page.getByRole('button', { name: 'Set up my vault', exact: true })).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Local-only sample', exact: true })).toHaveCount(0);

  await expect(page.locator('app-pin-input')).toHaveCount(0);
});

test('shows an unavailable backup state in Spanish without enabling another storage mode', async ({ page }) => {
  await page.route('**/api/example/vault/policy', async (route) => {
    const response = await route.fetch();
    const profile = await response.json();

    delete profile.objectBackups;

    await route.fulfill({ response, json: profile });
  });

  await signup(page);

  await page.goto('/app/es/example/vault');

  const heading = page.getByRole('heading', { level: 1, name: /bóveda|vault/i });

  await expect(heading).toBeVisible();

  await expect(
    page.getByRole('status').filter({ hasText: 'Por ahora no se pueden guardar respaldos de la bóveda.' }),
  ).toBeVisible();

  await expect(page.getByRole('button', { name: 'Configurar mi bóveda', exact: true })).toHaveCount(0);

  await expect(page.locator('app-pin-input')).toHaveCount(0);
});

test('sets up one synchronized Vault with an explicitly chosen PIN and reopens its note', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'credentials', { value: undefined }));

  const email = await signup(page);

  await page.goto('/app/en/example/vault');

  const setup = page.getByRole('button', { name: 'Set up my vault', exact: true });
  const pinOption = page.getByRole('button', { name: 'Use a PIN on this device', exact: true });
  const pin = page.getByLabel('Local unlock PIN', { exact: true });
  const confirmation = page.getByLabel('Confirm your new PIN', { exact: true });
  const unlock = page.getByRole('button', { name: 'Unlock with PIN', exact: true });
  const note = 'SYNTHETIC_NOTE_IN_THE_SYNCED_VAULT';

  await expect(setup).toHaveCount(1);

  await expect(page.getByRole('heading', { name: 'Local-only sample', exact: true })).toHaveCount(0);

  await expect(page.locator('app-pin-input')).toHaveCount(0);

  await setup.click();

  await expect(pinOption).toBeVisible();

  await expect(page.locator('app-pin-input')).toHaveCount(0);

  await pinOption.click();

  await pin.fill('048261');

  await confirmation.fill('048261');

  await page.getByRole('button', { name: 'Set up with PIN', exact: true }).click();

  await page.getByLabel('Your note', { exact: true }).fill(note);

  await expect(page.getByRole('button', { name: /save encrypted|upload encrypted/i })).toHaveCount(0);

  await expect(page.locator('app-vault-sync-indicator').getByRole('status')).toHaveText('Vault synced');

  const workspace = page.url();

  await page.reload();

  await expect(page).toHaveURL(workspace);

  await expect(page.getByText('You’re signed in. Unlock this vault to open your note.')).toBeVisible();

  await expect(unlock).toBeVisible();

  await expect(confirmation).toHaveCount(0);

  await expect(page.getByText(note, { exact: true })).toHaveCount(0);

  await pin.fill('048260');

  await unlock.click();

  await expect(page.getByRole('status').filter({ hasText: /PIN|encrypted data/i })).toBeVisible();

  await expect(page.getByText(note, { exact: true })).toHaveCount(0);

  await pin.fill('048261');

  await unlock.click();

  await expect(page.getByLabel('Your note', { exact: true })).toHaveValue(note);

  const primary = page.locator('app-sidebar').getByRole('navigation', { name: 'Primary navigation' });

  await primary.getByRole('link', { name: 'Home', exact: true }).click();

  await primary.getByRole('link', { name: 'Vault example', exact: true }).click();

  await page.getByRole('button', { name: /Open vault/ }).click();

  await expect(page).toHaveURL(workspace);

  await expect(setup).toHaveCount(0);

  await logout(page);

  await page.goto(workspace);

  await page.getByRole('link', { name: 'Use a password', exact: true }).click();

  await page.getByLabel('Email address', { exact: true }).fill(email);

  await page.getByLabel('Password', { exact: true }).fill(password);

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Confirm your sign-in', exact: true })).toBeVisible();

  const code = await readMailCode(email);

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await expect(page).toHaveURL(workspace);

  await expect(unlock).toBeVisible();

  await page.goto('/app/en/example/cloud');

  await expect(page.getByRole('button', { name: 'Create a test workspace' })).toBeVisible();

  await expect(page.getByLabel('Local unlock PIN', { exact: true })).toHaveCount(0);
});

test('a canceled passkey setup stays retryable without offering PIN', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: class {
        static async getClientCapabilities() {
          return { 'extension:prf': true };
        }
      },
    });
    Object.defineProperty(navigator, 'credentials', {
      value: {
        async create() {
          throw new DOMException('Synthetic cancellation', 'NotAllowedError');
        },
        async get() {
          throw new Error('A canceled enrollment should not request an assertion');
        },
      },
    });
  });

  await signup(page);

  await page.goto('/app/en/example/vault');

  await page.getByRole('button', { name: 'Set up my vault', exact: true }).click();

  const passkey = page.getByRole('button', { name: 'Set up with a passkey', exact: true });

  await passkey.click();

  await expect(page.getByRole('status').filter({ hasText: 'Unlock canceled.' })).toBeVisible();

  await expect(passkey).toBeEnabled();

  await expect(page.getByRole('button', { name: 'Use a PIN on this device', exact: true })).toHaveCount(0);

  await expect(page.locator('app-pin-input')).toHaveCount(0);
});

test.describe('Vault passkey setup in Chromium', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ browserName }) => browserName !== 'chromium', 'Requires a Chromium virtual authenticator');

  test('sets up the synchronized Vault with verified PRF and no PIN', async ({ page }) => {
    const cdp = await virtualPasskey(page);
    let assertions = 0;

    cdp.on('WebAuthn.credentialAsserted', () => assertions++);

    await signup(page);

    await page.goto('/app/en/example/vault');

    await page.getByRole('button', { name: 'Set up my vault', exact: true }).click();

    await page.getByRole('button', { name: 'Set up with a passkey', exact: true }).click();

    await expect(page.getByLabel('Your note', { exact: true })).toBeVisible();

    await expect(page.getByLabel('Your note', { exact: true })).toBeEditable();

    expect(assertions).toBe(1);

    await expect(page.locator('app-pin-input')).toHaveCount(0);

    const workspace = page.url();

    await page.reload();

    await expect(page).toHaveURL(workspace);

    await expect(page.getByText('You’re signed in. Unlock this vault to open your note.')).toBeVisible();

    expect(assertions).toBe(1);

    await page.getByRole('button', { name: 'Unlock with a passkey', exact: true }).click();

    await expect(page.getByLabel('Your note', { exact: true })).toBeEditable();

    expect(assertions).toBe(2);
  });

  test('opens the backed note on an approved desktop with its own PIN and no passkey', async ({
    page,
    browser,
  }, info) => {
    await virtualPasskey(page);

    const email = await signup(page);

    await page.goto('/app/en/example/vault');

    await page.getByRole('button', { name: 'Set up my vault' }).click();

    await page.getByRole('button', { name: 'Set up with a passkey' }).click();

    const note = 'Synthetic note from the first linked device';
    const [publication] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/sync/push')),
      page.getByLabel('Your note', { exact: true }).fill(note),
    ]);

    expect(publication.ok()).toBe(true);

    await expect(page.locator('app-vault-sync-indicator').getByRole('status')).toHaveText('Vault synced');

    const workspace = page.url();

    await page.getByRole('link', { name: 'Link a device' }).click();

    const desktop = await browser.newContext({ baseURL: info.project.use.baseURL });

    try {
      await desktop.addInitScript(() => Object.defineProperty(navigator, 'credentials', { value: undefined }));

      const peer = await desktop.newPage();

      await passwordStart(peer, email);

      const code = await readMailCode(email);

      await peer.getByLabel('Verification code', { exact: true }).fill(code);

      await expect(peer.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

      await peer.goto(workspace);

      await expect(peer.getByLabel('Your note', { exact: true })).toHaveCount(0);

      await peer.getByRole('link', { name: 'Link a device' }).click();

      const pin = peer.getByLabel('Local unlock PIN', { exact: true });

      await pin.fill('208146');

      await peer.getByLabel('Confirm your new PIN').fill('208146');

      await peer.getByRole('button', { name: 'Request pairing with PIN' }).click();

      const proof = await peer.getByLabel('Pairing request', { exact: true }).inputValue();
      const fingerprint = await peer.locator('[data-vault-recipient]').innerText();

      await page.getByLabel('Pairing request', { exact: true }).fill(proof);

      await page.getByLabel('New device fingerprint').fill(fingerprint);

      await page.getByRole('button', { name: 'Approve this device' }).click();

      await expect(page.getByRole('status').filter({ hasText: 'Device approved.' })).toBeVisible();

      const approver = await page.locator('[data-vault-approver]').innerText();

      await peer.getByLabel('Approving device fingerprint', { exact: true }).fill(approver);

      await pin.fill('208146');

      await peer.getByRole('button', { name: 'Finish pairing' }).click();

      await peer.getByRole('link', { name: 'Open vault note' }).click();

      await expect(peer.getByLabel('Your note', { exact: true })).toHaveValue(note);

      await peer.reload();

      await pin.fill('208146');

      await peer.getByRole('button', { name: 'Unlock with PIN', exact: true }).click();

      await expect(peer.getByLabel('Your note', { exact: true })).toHaveValue(note);
    } finally {
      await desktop.close();
    }
  });
});
