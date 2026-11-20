import { expect, signup, test } from './support/fixtures';

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

  await signup(page);

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

  await page.getByLabel('Private text', { exact: true }).fill(note);

  await page.getByRole('button', { name: 'Save encrypted change', exact: true }).click();

  await page.getByRole('button', { name: 'Upload encrypted note', exact: true }).click();

  await expect(page.getByRole('status').filter({ hasText: 'The encrypted note is backed up' })).toBeVisible();

  await page.reload();

  await expect(unlock).toBeVisible();

  await expect(confirmation).toHaveCount(0);

  await expect(page.getByText(note, { exact: true })).toHaveCount(0);

  await pin.fill('048260');

  await unlock.click();

  await expect(page.getByRole('status').filter({ hasText: /PIN|encrypted data/i })).toBeVisible();

  await expect(page.getByText(note, { exact: true })).toHaveCount(0);

  await pin.fill('048261');

  await unlock.click();

  await expect(page.locator('pre')).toHaveText(note);
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

  test('sets up the synchronized Vault with verified PRF and no PIN', async ({ context, page }) => {
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

    await page.goto('/app/en/example/vault');

    await page.getByRole('button', { name: 'Set up my vault', exact: true }).click();

    await page.getByRole('button', { name: 'Set up with a passkey', exact: true }).click();

    await expect(page.getByLabel('Private text', { exact: true })).toBeVisible();

    await expect(page.locator('app-pin-input')).toHaveCount(0);
  });
});
