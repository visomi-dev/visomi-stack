import type { Locator, Page } from '@playwright/test';
import { readMailCode } from '@visomi-stack/dev-testing';

import {
  expect,
  expireSession,
  logout,
  passkeySignup,
  password,
  signup,
  passwordStart,
  test,
  vaultUnlockUrl,
  virtualPasskey,
} from './support/fixtures';

async function legacyPasskeySignup(page: Page) {
  // Recreate the registration options shipped in 463ab0b on a PRF-capable authenticator.
  await page.route('**/api/auth/passkeys/registration/options', async (route) => {
    const response = await route.fetch();
    const registration: { options: { extensions?: { prf?: unknown } } } = await response.json();

    delete registration.options.extensions?.prf;

    await route.fulfill({ response, json: registration });
  });

  return passkeySignup(page);
}

async function expectCenteredCard(card: Locator): Promise<void> {
  await expect(card).toBeVisible();

  const offset = await card.evaluate((element) => {
    const card = element.getBoundingClientRect();
    const container = element.parentElement!.getBoundingClientRect();

    return Math.abs(card.left + card.width / 2 - (container.left + container.width / 2));
  });

  expect(offset).toBeLessThanOrEqual(1);
}

test('opens the Vault navigation item without offering a separate vault when the API is unavailable', async ({
  page,
}) => {
  await page.route('**/api/example/{vault,cloud}/policy', (route) => route.fulfill({ status: 404 }));

  await page.goto('/app/en/db-example/vault');

  await expect(page).toHaveURL(/\/auth\/sign-in/);

  await signup(page);

  const primary = page.locator('app-sidebar').getByRole('navigation', { name: 'Primary navigation' });

  await expect(primary.getByRole('link').last()).toHaveText('Vault example');

  await expect(primary.getByRole('link', { name: 'Cloud example', exact: true })).toHaveCount(0);

  await primary.getByRole('link', { name: 'Vault example', exact: true }).click();

  await expect(page).toHaveURL(/\/db-example\/vault$/);

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

  await page.goto('/app/es/db-example/vault');

  const heading = page.getByRole('heading', { level: 1, name: /bóveda|vault/i });

  await expect(heading).toBeVisible();

  await expect(
    page.getByRole('status').filter({ hasText: 'Por ahora no se pueden guardar respaldos de la bóveda.' }),
  ).toBeVisible();

  await expect(page.getByRole('button', { name: 'Configurar mi bóveda', exact: true })).toHaveCount(0);

  await expect(page.locator('app-pin-input')).toHaveCount(0);
});

test('sets up one synchronized Vault with an explicitly chosen PIN and reopens its note', async ({ page }, info) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'credentials', { value: undefined }));

  const email = await signup(page);

  await page.goto('/app/en/db-example/vault');

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

  const [publication] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/sync/push')),
    page.getByLabel('Your note', { exact: true }).fill(note),
  ]);

  expect(publication.ok()).toBe(true);

  await expect(page.getByRole('button', { name: /save encrypted|upload encrypted/i })).toHaveCount(0);

  await expect(page.locator('app-vault-sync-indicator').getByRole('status')).toHaveText('Vault synced');

  const workspace = page.url();

  await page.setViewportSize({ width: 390, height: 844 });

  await page.reload();

  await expect(page).toHaveURL(vaultUnlockUrl(workspace));

  const locked = page.getByRole('region', { name: 'Unlock your vault', exact: true });

  await expectCenteredCard(locked);

  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();

  await expect(page.getByText('You’re signed in. Unlock this vault to open your note.')).toHaveCount(0);

  await expect(locked.getByRole('button', { name: 'Use a passkey', exact: true })).toHaveCount(0);

  await expect(unlock).toHaveCount(0);

  await expect(locked.getByText('Use your PIN to view your data.', { exact: true })).toBeVisible();

  const pinWidget = locked.locator('app-pin-input');
  const pinWidth = await pinWidget.boundingBox();
  const fieldWidth = await locked.locator('app-field').boundingBox();

  expect(pinWidth?.width).toBeCloseTo(fieldWidth!.width);

  await expect(pinWidget.locator('.slot')).toHaveCount(6);

  await pin.focus();

  await expect(pin).toBeFocused();

  await page.screenshot({ path: info.outputPath('vault-pin-locked-mobile.png'), animations: 'disabled' });

  await expect(confirmation).toHaveCount(0);

  await expect(page.getByText(note, { exact: true })).toHaveCount(0);

  await pin.fill('048260');

  await expect(page.getByRole('status').filter({ hasText: /PIN|encrypted data/i })).toBeVisible();

  await expect(page.getByText(note, { exact: true })).toHaveCount(0);

  await expect(pin).toHaveValue('');

  await expect(pin).toBeFocused();

  await pin.fill('048261');

  await expect(page.getByLabel('Your note', { exact: true })).toHaveValue(note);

  await page.setViewportSize({ width: 1280, height: 900 });

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

  await expect(page).toHaveURL(vaultUnlockUrl(workspace));

  await expect(pin).toBeVisible();

  await page.goto('/app/en/db-example/cloud');

  await expect(page.getByRole('button', { name: 'Create a test workspace' })).toBeVisible();

  await expect(page.getByLabel('Local unlock PIN', { exact: true })).toHaveCount(0);
});

test.describe('Vault passkey setup in Chromium', () => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ browserName }) => browserName !== 'chromium', 'Requires a Chromium virtual authenticator');

  test('resumes the same setup after cancellation and a bootstrap failure, then lists the empty vault', async ({
    page,
  }) => {
    const { credentialIds } = await virtualPasskey(page);

    await passkeySignup(page);

    const registered = await credentialIds();
    const directory = '/app/en/db-example/vault';
    const resume = page.getByRole('button', { name: 'Continue vault setup', exact: true });
    const open = page.getByRole('button', { name: /^Open vault/ });
    const passkey = page.getByRole('button', { name: 'Set up with a passkey', exact: true });
    const note = page.getByLabel('Your note', { exact: true });

    await page.goto(directory);

    await page.getByRole('button', { name: 'Set up my vault', exact: true }).click();

    await expect(passkey).toBeVisible();

    const workspace = page.url();

    await page.evaluate(() => {
      Object.defineProperty(navigator.credentials, 'get', {
        value: async () => {
          throw new DOMException('Synthetic user cancellation', 'NotAllowedError');
        },
      });
    });

    await passkey.click();

    await expect(page.getByRole('status').filter({ hasText: 'Unlock canceled.' })).toBeVisible();

    await page.goto(directory);

    await expect(resume).toBeVisible();

    await expect(open).toHaveCount(0);

    await resume.click();

    await expect(page).toHaveURL(workspace);

    await page.route(
      '**/devices/bootstrap',
      (route) => route.fulfill({ status: 503, json: { error: 'persistence_unavailable' } }),
      { times: 1 },
    );

    await passkey.click();

    await expect(
      page.getByRole('status').filter({ hasText: 'Private storage is unavailable on this device.' }),
    ).toBeVisible();

    await expect(note).toHaveCount(0);

    await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toHaveCount(0);

    await page.reload();

    await expect(passkey).toBeEnabled();

    await page.goto(directory);

    await expect(resume).toBeVisible();

    await expect(open).toHaveCount(0);

    await resume.click();

    await expect(page).toHaveURL(workspace);

    await page.route(
      '**/devices/bootstrap',
      async (route) => {
        const committed = await route.fetch();

        expect(committed.ok()).toBe(true);

        await route.abort('failed');
      },
      { times: 1 },
    );

    await passkey.click();

    await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();

    const afterSetup = await credentialIds();

    expect(afterSetup).toEqual(registered);

    await page.goto(directory);

    await expect(page.getByRole('heading', { name: 'Your vaults', exact: true })).toBeVisible();

    await expect(open).toHaveCount(1);

    await expect(resume).toHaveCount(0);

    await open.click();

    await expect(page).toHaveURL(vaultUnlockUrl(workspace));

    await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();

    const [firstPull] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/sync/pull')),
      page.getByRole('button', { name: 'Use a passkey', exact: true }).click(),
    ]);

    expect(firstPull.ok()).toBe(true);

    await expect(note).toBeEditable();

    await expect(note).toHaveValue('');
  });

  test('hard reload keeps an unconfigured Vault in the verified passkey session', async ({ page, browser }) => {
    const { cdp, credentialIds } = await virtualPasskey(page);
    const email = await passkeySignup(page);
    const registered = await credentialIds();

    expect(registered).toHaveLength(1);

    await page.locator('app-sidebar').getByRole('link', { name: 'Vault example', exact: true }).click();

    const setup = page.getByRole('button', { name: 'Set up my vault', exact: true });

    await expect(setup).toBeVisible();

    async function reloadVault() {
      const url = page.url();
      const document = page.waitForResponse(
        (response) => response.request().isNavigationRequest() && response.url() === url,
      );

      await cdp.send('Page.reload', { ignoreCache: true });

      return document;
    }

    async function expectAuthenticatedReload() {
      const url = page.url();
      const cookies = await page.context().cookies(url);
      const response = await reloadVault();
      const html = await response.text();

      expect(cookies.some(({ name }) => name === 'visomi.sid')).toBe(true);

      expect(response.status()).toBe(200);
      expect(html).toMatch(/"auth-initial-session":\{"available":true,"session":\{[^<]+?"access":"full"/);

      await expect(page).toHaveURL(url);

      await expect(page.getByRole('heading', { name: 'Vault example', exact: true })).toBeVisible();

      await expect(page.getByRole('heading', { name: 'Unlock your vault', exact: true })).toHaveCount(0);

      const session = await page.request.get('/api/auth/session');
      const state: unknown = await session.json();

      expect(state).toMatchObject({ access: 'full', user: { emailVerified: true }, method: 'passkey' });
    }

    await expectAuthenticatedReload();

    await setup.click();

    await page.evaluate(() => {
      Object.defineProperty(navigator.credentials, 'get', {
        value: async () => {
          throw new DOMException('Synthetic user cancellation', 'NotAllowedError');
        },
      });
    });

    const passkey = page.getByRole('button', { name: 'Set up with a passkey', exact: true });

    await passkey.click();

    await expect(page.getByRole('status').filter({ hasText: 'Unlock canceled.' })).toBeVisible();

    const afterCancellation = await credentialIds();

    expect(afterCancellation).toEqual(registered);

    await expect(passkey).toBeEnabled();

    await expectAuthenticatedReload();

    await expect(passkey).toBeVisible();

    await expect(page.getByRole('button', { name: 'Use a PIN on this device', exact: true })).toHaveCount(0);

    const workspace = new URL(page.url());
    const returnTo = workspace.pathname.replace('/app/en', '') + workspace.search;
    const anonymous = await browser.newContext();

    try {
      const response = await anonymous.request.get(workspace.href, { maxRedirects: 0 });
      const redirect = new URL(response.headers()['location'], workspace);

      expect(response.status()).toBe(302);
      expect(redirect.pathname).toBe('/app/en/auth/sign-in');
      expect(redirect.searchParams.get('returnTo')).toBe(returnTo);
    } finally {
      await anonymous.close();
    }

    await expireSession(email);

    const response = await reloadVault();

    expect(response.status()).toBe(302);

    await expect(page).toHaveURL(
      (url) => url.pathname === '/app/en/auth/sign-in' && url.searchParams.get('returnTo') === returnTo,
    );

    await page.getByRole('button', { name: 'Sign in with a passkey', exact: true }).click();

    await expect(page).toHaveURL(workspace.href);

    await expect(passkey).toBeVisible();

    await page.goto(vaultUnlockUrl(workspace));

    await expect(page).toHaveURL(workspace.href);

    await expect(passkey).toBeVisible();
  });

  test('rejects another account’s passkey even when it can assert for the same RP', async ({ page }) => {
    const { cdp, credentialIds } = await virtualPasskey(page);

    await passkeySignup(page);

    const [foreign] = await credentialIds();

    await logout(page);

    await passkeySignup(page);

    const registered = await credentialIds();
    const owned = registered.find((id) => id !== foreign)!;
    const ownedId = Buffer.from(owned, 'base64').toString('base64url');
    const list = await page.request.get('/api/auth/passkeys/vault-credentials');

    const passkeys: unknown = await list.json();

    expect(list.headers()['cache-control']).toBe('no-store');
    expect(passkeys).toEqual({ credentialIds: [ownedId] });
    expect(registered).toHaveLength(2);

    await page.goto('/app/en/db-example/vault');

    await page.getByRole('button', { name: 'Set up my vault', exact: true }).click();

    await page.evaluate(
      (bytes) => {
        const get = navigator.credentials.get.bind(navigator.credentials);

        Object.defineProperty(navigator.credentials, 'get', {
          value: (options: CredentialRequestOptions) =>
            get({
              ...options,
              publicKey: {
                ...options.publicKey!,
                allowCredentials: [{ type: 'public-key', id: Uint8Array.from(bytes) }],
              },
            }),
        });
      },
      Array.from(Buffer.from(foreign, 'base64')),
    );

    const asserted: string[] = [];

    cdp.on('WebAuthn.credentialAsserted', ({ credential }) => asserted.push(credential.credentialId));

    const passkey = page.getByRole('button', { name: 'Set up with a passkey', exact: true });

    await passkey.click();

    await expect(
      page.getByRole('status').filter({ hasText: 'Use a passkey registered to this account.' }),
    ).toBeVisible();

    expect(asserted).toEqual([foreign]);
    const afterRejection = await credentialIds();

    expect(afterRejection).toEqual(registered);

    await expect(page.getByRole('button', { name: 'Use a PIN on this device', exact: true })).toHaveCount(0);

    await page.reload();

    await expect(passkey).toBeEnabled();

    await passkey.click();

    await expect(page.getByLabel('Your note', { exact: true })).toBeEditable();

    expect(asserted).toEqual([foreign, owned]);
    const afterRetry = await credentialIds();

    expect(afterRetry).toEqual(registered);
  });

  for (const { hasPrf, register, caseName } of [
    { hasPrf: true, register: legacyPasskeySignup, caseName: 'legacy registration on a PRF-capable authenticator' },
    { hasPrf: false, register: passkeySignup, caseName: 'new registration on an authenticator without PRF' },
  ]) {
    test(`offers a local PIN after a valid assertion without PRF (${caseName})`, async ({ page }) => {
      const { cdp, credentialIds } = await virtualPasskey(page, hasPrf);

      await register(page);

      const registered = await credentialIds();
      const asserted: string[] = [];

      cdp.on('WebAuthn.credentialAsserted', ({ credential }) => asserted.push(credential.credentialId));

      await page.goto('/app/en/db-example/vault');

      await page.getByRole('button', { name: 'Set up my vault', exact: true }).click();

      const pinOption = page.getByRole('button', { name: 'Use a PIN on this device', exact: true });

      await expect(pinOption).toHaveCount(0);

      await page.getByRole('button', { name: 'Set up with a passkey', exact: true }).click();

      await expect(pinOption).toBeVisible();

      expect(asserted).toEqual(registered);
      const afterUnsupported = await credentialIds();

      expect(afterUnsupported).toEqual(registered);

      await expect(page.locator('app-pin-input')).toHaveCount(0);

      await expect(page.getByLabel('Your note', { exact: true })).toHaveCount(0);

      await pinOption.click();

      await page.getByLabel('Local unlock PIN', { exact: true }).fill('048261');

      await page.getByLabel('Confirm your new PIN', { exact: true }).fill('048261');

      await page.getByRole('button', { name: 'Set up with PIN', exact: true }).click();

      await expect(page.getByLabel('Your note', { exact: true })).toBeEditable();

      const afterPin = await credentialIds();

      expect(afterPin).toEqual(registered);
    });
  }

  test('sets up the synchronized Vault with verified PRF and no PIN', async ({ page }, info) => {
    const { cdp, credentialIds } = await virtualPasskey(page);
    const assertions: string[] = [];
    let prfSent = false;

    cdp.on('WebAuthn.credentialAsserted', ({ credential }) => assertions.push(credential.credentialId));
    page.on('request', (request) => {
      prfSent ||= /"prf"\s*:/.test(request.postData() ?? '');
    });

    await passkeySignup(page);

    const registered = await credentialIds();

    expect(registered).toHaveLength(1);

    await page.goto('/app/en/db-example/vault');

    await page.getByRole('button', { name: 'Set up my vault', exact: true }).click();

    await page.getByRole('button', { name: 'Set up with a passkey', exact: true }).click();

    await expect(page.getByLabel('Your note', { exact: true })).toBeVisible();

    await expect(page.getByLabel('Your note', { exact: true })).toBeEditable();

    expect(assertions).toEqual(registered);
    const afterSetup = await credentialIds();

    expect(afterSetup).toEqual(registered);

    await expect(page.locator('app-pin-input')).toHaveCount(0);

    const workspace = page.url();

    await page.reload();

    await expect(page).toHaveURL(vaultUnlockUrl(workspace));

    const locked = page.getByRole('region', { name: 'Unlock your vault', exact: true });
    const usePasskey = locked.getByRole('button', { name: 'Use a passkey', exact: true });

    await expectCenteredCard(locked);

    await expect(page.locator('app-sidebar').getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();

    await expect(locked.getByLabel('Local unlock PIN', { exact: true })).toHaveCount(0);

    await expect(usePasskey).toBeEnabled();

    expect(assertions).toEqual(registered);

    await usePasskey.focus();

    await expect(usePasskey).toBeFocused();

    await page.screenshot({ path: info.outputPath('vault-passkey-locked-desktop.png'), animations: 'disabled' });

    await usePasskey.press('Enter');

    await expect(page.getByLabel('Your note', { exact: true })).toBeEditable();

    expect(assertions).toEqual([...registered, ...registered]);
    const afterUnlock = await credentialIds();

    expect(afterUnlock).toEqual(registered);
    expect(prfSent).toBe(false);
  });

  test('opens the backed note on an approved desktop with its own PIN and no passkey', async ({
    page,
    browser,
  }, info) => {
    await virtualPasskey(page);

    const email = await signup(page);

    await page.goto('/app/en/security/passkeys');

    await page.getByRole('button', { name: 'Add a passkey', exact: true }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Passkey added.' })).toBeVisible();

    await page.goto('/app/en/db-example/vault');

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
      await desktop.routeWebSocket('**/socket.io/**', (socket) => socket.close());

      await desktop.addInitScript(() => Object.defineProperty(navigator, 'credentials', { value: undefined }));

      const peer = await desktop.newPage();

      await passwordStart(peer, email);

      const code = await readMailCode(email);

      await peer.getByLabel('Verification code', { exact: true }).fill(code);

      await expect(peer.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

      await peer.goto(vaultUnlockUrl(workspace));

      await expect(peer).toHaveURL(workspace);

      await expect(peer.getByLabel('Your note', { exact: true })).toHaveCount(0);

      await expect(peer.getByRole('button', { name: 'Set up with a passkey', exact: true })).toHaveCount(0);

      await peer.getByRole('link', { name: 'Link a device' }).click();

      const pin = peer.getByLabel('Local unlock PIN', { exact: true });

      await pin.fill('208146');

      await peer.getByLabel('Confirm your new PIN').fill('208146');

      await peer.getByRole('button', { name: 'Request pairing with PIN' }).click();

      const reviewLink = peer.getByRole('link', { name: 'Open review link', exact: true });

      await expect(reviewLink).toBeVisible();

      const href = await reviewLink.getAttribute('href');
      const fingerprint = await peer.locator('[data-vault-recipient]').innerText();
      const relative = new URL(href!);

      await page.goto(relative.href);

      await expect(
        page.getByText('Unlock the note on this device before approving another one.', { exact: true }),
      ).toBeVisible();

      await page.getByRole('link', { name: 'Open vault note', exact: true }).click();

      await page.getByRole('button', { name: 'Use a passkey', exact: true }).click();

      await expect(page.getByLabel('Your note', { exact: true })).toHaveValue(note);

      await page.getByRole('link', { name: 'Review request', exact: true }).click();

      await expect(page).toHaveURL(relative.href);

      await page.getByLabel('New device fingerprint').fill(fingerprint);

      await page.getByRole('button', { name: 'Approve this device' }).click();

      await expect(page.getByRole('status').filter({ hasText: 'Device approved.' })).toBeVisible();

      const approver = await page.locator('[data-vault-approver]').innerText();

      const trust = peer.getByLabel('Approving device fingerprint', { exact: true });

      await expect(trust).toBeVisible({ timeout: 15_000 });

      await trust.fill(approver);

      await pin.fill('208146');

      await peer.getByRole('button', { name: 'Finish pairing' }).click();

      await peer.getByRole('link', { name: 'Open vault note' }).click();

      await expect(peer.getByLabel('Your note', { exact: true })).toHaveValue(note);

      await peer.reload();

      await pin.fill('208146');

      await expect(peer.getByLabel('Your note', { exact: true })).toHaveValue(note);
    } finally {
      await desktop.close();
    }
  });
});
