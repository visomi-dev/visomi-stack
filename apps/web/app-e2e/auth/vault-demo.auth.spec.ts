import type { Page } from '@playwright/test';

import { expect, signup, test } from './support/fixtures';

test('opens the last primary navigation item and unlocks the isolated synthetic sample', async ({ page }, info) => {
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
  const primary = sidebar.getByRole('navigation', { name: 'Primary navigation' });
  const desktop = primary.getByRole('link', { name: 'Vault example', exact: true });

  await expect(primary.getByRole('link').last()).toHaveText('Vault example');

  await expect(sidebar.getByRole('link', { name: 'Privacy', exact: true })).toHaveAttribute('href', '/en/privacy/');

  await desktop.click();

  await expect(page).toHaveURL(/\/vault-example$/);

  await expect(page.getByRole('heading', { name: 'Vault example', level: 1 })).toBeVisible();

  const setup = page.getByRole('button', { name: 'Set up my vault' });
  const create = page.getByRole('button', { name: 'Set up the example vault' });
  const pin = page.getByLabel('Local unlock PIN', { exact: true });
  const confirm = page.getByLabel('Confirm your new PIN');
  const fallback = page.getByRole('button', { name: 'Use a local PIN' });

  await expect(setup).toBeVisible();

  await expect(pin).toHaveCount(0);

  await expect(confirm).toHaveCount(0);

  await expect(fallback).toHaveCount(0);

  await setup.click();

  await expect(page.getByRole('status').filter({ hasText: 'Passkey unlock is unavailable here.' })).toBeVisible();

  await expect(pin).toHaveCount(0);

  await expect(confirm).toHaveCount(0);

  await fallback.click();

  await expect(create).toBeVisible();

  const card = page.locator('app-vault-demo > section');
  const visibleWidth = await card.evaluate((section) => {
    const box = section.getBoundingClientRect();
    const content = section.closest('[data-slot="page-content"]')!.getBoundingClientRect();
    const input = section.querySelector('app-pin-input')!.getBoundingClientRect();
    const innerWidth = section.querySelector('form')!.getBoundingClientRect().width;

    return {
      width: box.width,
      centerDifference: Math.abs((box.left + box.right - content.left - content.right) / 2),
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

  await confirm.fill('048261');

  await create.click();

  const read = page.getByRole('button', { name: 'Open the example note' });
  const sample = page.getByText('Sample note: Garden workshop at 10:00.');

  await read.click();

  await expect(sample).toBeVisible();

  await page.reload();

  await expect(setup).toHaveCount(0);

  await expect(confirm).toHaveCount(0);

  await expect(sample).toHaveCount(0);

  await expect(read).toHaveCount(0);

  const unlock = page.getByRole('button', { name: 'Unlock with PIN' });

  await pin.fill('048260');

  await unlock.click();

  await expect(page.getByRole('alert')).toHaveText(/This PIN couldn’t unlock your vault/);

  await expect(page.getByText('Private resources are locked.')).toBeVisible();

  await expect(read).toHaveCount(0);

  await expect(sample).toHaveCount(0);

  await pin.fill('048261');

  await unlock.click();

  await read.click();

  await expect(sample).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });

  await page.emulateMedia({ colorScheme: 'dark' });

  await page.getByRole('button', { name: 'Menu', exact: true }).click();

  const menu = page.getByRole('dialog', { name: 'Primary navigation' });
  const mobile = menu.getByRole('navigation', { name: 'Primary navigation' });

  await expect(mobile.getByRole('link').last()).toHaveText('Vault example');

  await expect(menu.getByRole('link', { name: 'Privacy', exact: true })).toHaveAttribute('href', '/en/privacy/');

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
  const localizedPrimary = localized.getByRole('navigation', { name: 'Navegación principal' });

  await expect(localizedPrimary.getByRole('link').last()).toHaveText('Ejemplo de vault');

  await expect(localized.getByRole('link', { name: 'Privacidad', exact: true })).toHaveAttribute(
    'href',
    '/es/privacy/',
  );

  expect(persistence).toEqual([]);
});

test.describe('Chromium virtual authenticator', () => {
  // Chromium provides the native virtual CTAP2 authenticator over CDP.
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ browserName }) => browserName !== 'chromium', 'Requires Chromium CDP');

  test('uses verified PRF without a PIN and reopens the same vault', async ({ page }) => {
    const writes = await beginVirtualPasskeySetup(page, true);

    await finishPasskeySetup(page);

    await expect(page.locator('app-vault-demo app-pin-input')).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Use a local PIN' })).toHaveCount(0);

    await provePasskeyUnlock(page);

    expect(writes).toEqual([]);
  });

  test('offers an explicit PIN choice after a valid assertion has no PRF output', async ({ page }) => {
    const writes = await beginVirtualPasskeySetup(page, false);
    const fallback = page.getByRole('button', { name: 'Use a local PIN' });
    const pin = page.getByLabel('Local unlock PIN', { exact: true });

    await expect(fallback).toBeVisible();

    await expect(pin).toHaveCount(0);

    await fallback.click();

    await expect(pin).toBeVisible();

    expect(writes).toEqual([]);
  });
});

test('simulates cancellation, unexpected failure, fresh activation and a retryable PRF assertion', async ({ page }) => {
  await page.addInitScript(() => {
    let discovery = 0;
    let verification = 0;

    Object.defineProperty(navigator, 'userActivation', { value: { isActive: false } });
    Object.defineProperty(navigator, 'credentials', {
      value: {
        async get({ publicKey }: CredentialRequestOptions) {
          if (!publicKey) {
            throw new Error('The test expects a public key request');
          }

          const discovering = !publicKey.allowCredentials?.length;
          const attempt = discovering ? ++discovery : ++verification;

          if (attempt === 1) {
            throw new DOMException('Synthetic cancellation', 'NotAllowedError');
          }

          if (discovering && attempt === 2) {
            throw new DOMException('Synthetic transport failure', 'UnknownError');
          }

          const input = publicKey.extensions?.prf?.eval?.first;

          if (!input || publicKey.userVerification !== 'required' || publicKey.rpId !== location.hostname) {
            throw new Error('Unexpected PRF request');
          }

          const rawId = new Uint8Array([31]).buffer;
          const allowedId = publicKey.allowCredentials?.[0]?.id;

          if (!discovering && (!(allowedId instanceof Uint8Array) || allowedId.length !== 1 || allowedId[0] !== 31)) {
            throw new Error('Unexpected PRF credential filter');
          }

          const encoder = new TextEncoder();
          const rpIdHash = await crypto.subtle.digest('SHA-256', encoder.encode(location.hostname));
          const authenticatorData = new Uint8Array(37);

          authenticatorData.set(new Uint8Array(rpIdHash));
          authenticatorData[32] = 5;

          const challenge =
            publicKey.challenge instanceof ArrayBuffer
              ? new Uint8Array(publicKey.challenge)
              : new Uint8Array(
                  publicKey.challenge.buffer,
                  publicKey.challenge.byteOffset,
                  publicKey.challenge.byteLength,
                );
          const clientDataJSON = encoder.encode(
            JSON.stringify({
              type: 'webauthn.get',
              challenge: btoa(String.fromCharCode(...challenge))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, ''),
              origin: location.origin,
            }),
          ).buffer;
          const first = await crypto.subtle.digest('SHA-256', input);

          return {
            type: 'public-key',
            id: 'Hw',
            rawId,
            response: { authenticatorData: authenticatorData.buffer, clientDataJSON },
            getClientExtensionResults: () => ({ prf: { results: { first } } }),
          };
        },
      },
    });
  });

  await signup(page);

  await page.goto('/app/es/vault-example');

  const start = page.getByRole('button', { name: 'Configurar mi bóveda' });
  const verify = page.getByRole('button', { name: 'Verificar clave de acceso' });
  const fallback = page.getByRole('button', { name: 'Usar un PIN local' });
  const alert = page.getByRole('alert');

  await expect(page.locator('app-vault-demo app-pin-input')).toHaveCount(0);

  await start.click();

  await expect(alert).toContainText(/canceló/i);

  await expect(fallback).toHaveCount(0);

  await start.click();

  await expect(alert).toHaveText('No pudimos verificar tu clave de acceso. Intenta de nuevo.');

  await expect(fallback).toHaveCount(0);

  await start.click();

  await expect(verify).toBeVisible();

  await verify.click();

  await expect(alert).toContainText(/canceló/i);

  await expect(fallback).toHaveCount(0);

  await verify.click();

  await page.getByRole('button', { name: 'Abrir la nota de ejemplo' }).click();

  await expect(page.getByText('Nota de ejemplo: taller de jardinería a las 10:00.')).toBeVisible();

  await expect(page.locator('app-vault-demo app-pin-input')).toHaveCount(0);
});

async function beginVirtualPasskeySetup(page: Page, hasPrf: boolean): Promise<string[]> {
  await signup(page);

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
      hasPrf,
    },
  });

  // The synthetic fixture supplies a credential before the demo selects it.
  await page.evaluate(async () => {
    await navigator.credentials.create({
      publicKey: {
        rp: { id: location.hostname, name: 'Synthetic vault test' },
        user: { id: new Uint8Array(32).fill(31), name: 'vault-test@example.test', displayName: 'Synthetic vault test' },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: { prf: {} },
      },
    });
  });

  const writes: string[] = [];

  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;

    if (path.startsWith('/api/') && request.method() !== 'GET') {
      writes.push(path);
    }
  });

  await page.goto('/app/en/vault-example');

  await page.getByRole('button', { name: 'Set up my vault' }).click();

  return writes;
}

async function finishPasskeySetup(page: Page): Promise<void> {
  const verify = page.getByRole('button', { name: 'Verify passkey', disabled: false });
  const read = page.getByRole('button', { name: 'Open the example note' });

  await expect(verify.or(read)).toBeVisible();

  const needsVerification = await verify.isVisible();

  if (needsVerification) {
    await verify.click();
  }

  await expect(read).toBeVisible();
}

async function provePasskeyUnlock(page: Page): Promise<void> {
  const read = page.getByRole('button', { name: 'Open the example note' });
  const note = page.getByText('Sample note: Garden workshop at 10:00.');
  const unlock = page.getByRole('button', { name: 'Unlock with a passkey' });

  await read.click();

  await expect(note).toBeVisible();

  await page.getByRole('button', { name: 'Lock private resources' }).click();

  await expect(note).toHaveCount(0);

  await expect(read).toHaveCount(0);

  await expect(unlock).toBeVisible();

  await page.reload();

  await expect(unlock).toBeVisible();

  await expect(note).toHaveCount(0);

  await unlock.click();

  await read.click();

  await expect(note).toBeVisible();
}
