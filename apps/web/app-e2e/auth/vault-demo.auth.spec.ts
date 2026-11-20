import { readFile, rm } from 'node:fs/promises';

import type { Locator, Page } from '@playwright/test';
import { readMailCode } from '@visomi-stack/dev-testing';
import { vaultBackupSchema } from '@visomi-stack/shared-db';

import { expect, logout, passwordStart, signup, test } from './support/fixtures';

test('opens the last primary navigation item and unlocks the isolated synthetic sample', async ({ page }, info) => {
  const persistence: string[] = [];

  await page.addInitScript(() => Object.defineProperty(navigator, 'credentials', { value: undefined }));

  await page.setViewportSize({ width: 1366, height: 1024 });

  await page.emulateMedia({ colorScheme: 'light' });

  await page.route('**/api/example/{vault,cloud}/**', async (route) => {
    if (new URL(route.request().url()).pathname !== '/api/example/cloud/policy') {
      persistence.push('technical persistence request');
    }

    await route.fulfill({ status: 404 });
  });

  await page.goto('/app/en/example/vault');

  await expect(page).toHaveURL(/\/auth\/sign-in/);

  await signup(page);

  const sidebar = page.locator('app-sidebar');
  const primary = sidebar.getByRole('navigation', { name: 'Primary navigation' });
  const desktop = primary.getByRole('link', { name: 'Vault example', exact: true });

  await expect(primary.getByRole('link').last()).toHaveText('Vault example');

  await expect(sidebar.getByRole('link', { name: 'Privacy', exact: true })).toHaveAttribute('href', '/en/privacy/');

  await desktop.click();

  await expect(page).toHaveURL(/\/example\/vault$/);

  await expect(page.getByRole('heading', { name: 'Vault example', level: 1 })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Local encrypted download', exact: true })).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Back up and restore a test note', exact: true })).toHaveCount(0);

  await expect(primary.getByRole('link', { name: 'Cloud example', exact: true })).toHaveCount(0);

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

  await expect(page).toHaveURL(/\/app\/es\/example\/vault$/);

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

  await localizedPrimary.getByRole('link', { name: 'Ejemplo de vault' }).click();

  await expect(localized).toBeHidden();

  await page.getByLabel('PIN de desbloqueo local').fill('048261');

  await page.getByRole('button', { name: 'Desbloquear con PIN' }).click();

  await expect(page.getByRole('button', { name: 'Añadir passkey' })).toBeVisible();

  expect(persistence).toEqual([]);
});

test('downloads the local ciphertext only from an unlocked vault and keeps a same-account second profile isolated', async ({
  page,
  browser,
}, info) => {
  const backup = page.getByRole('button', { name: 'Download encrypted backup', exact: true });
  const sample = 'Sample note: Garden workshop at 10:00.';
  const pin = '048261';
  const requests: string[] = [];

  await page.addInitScript(() => Object.defineProperty(navigator, 'credentials', { value: undefined }));

  const email = await signup(page);

  await page.goto('/app/en/example/vault');

  await expect(page.getByRole('heading', { name: 'Local encrypted download', exact: true })).toBeVisible();

  await expect(backup).toHaveCount(0);

  await page.getByRole('button', { name: 'Set up my vault', exact: true }).click();

  await page.getByRole('button', { name: 'Use a local PIN', exact: true }).click();

  await page.getByLabel('Local unlock PIN', { exact: true }).fill(pin);

  await page.getByLabel('Confirm your new PIN', { exact: true }).fill(pin);

  await page.getByRole('button', { name: 'Set up the example vault', exact: true }).click();

  await page.getByRole('button', { name: 'Open the example note', exact: true }).click();

  await expect(page.getByText(sample, { exact: true })).toBeVisible();

  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/api/example/vault/')) {
      requests.push('unexpected persistence write');
    }
  });

  const [download] = await Promise.all([page.waitForEvent('download'), backup.click()]);
  const path = info.outputPath('synthetic-vault-backup.json');

  expect(download.suggestedFilename()).toBe('visomi-vault-example.backup.json');

  await download.saveAs(path);

  try {
    const serialized = await readFile(path, 'utf8');
    const artifact = vaultBackupSchema.parse(JSON.parse(serialized));

    expect(serialized).not.toContain(sample);
    expect(artifact.units).toHaveLength(1);
    const localCiphertext = await page.evaluate(async (owner) => {
      const storage = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(`visomi-vault:reference-demo:${owner}`);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      try {
        const envelopes = await new Promise<unknown>((resolve, reject) => {
          const request = storage.transaction('units').objectStore('units').getAll();

          request.onsuccess = () => resolve(request.result.map(({ envelope }) => envelope));
          request.onerror = () => reject(request.error);
        });

        return envelopes;
      } finally {
        storage.close();
      }
    }, artifact.key.context.ownerId);

    expect(localCiphertext).toEqual(artifact.units);
  } finally {
    await rm(path, { force: true });
  }

  await page.getByRole('button', { name: 'Lock private resources', exact: true }).click();

  await expect(backup).toHaveCount(0);

  const second = await browser.newContext({ baseURL: info.project.use.baseURL });

  try {
    const recipient = await second.newPage();

    await passwordStart(recipient, email);

    const code = await readMailCode(email);

    await recipient.getByLabel('Verification code', { exact: true }).fill(code);

    await expect(recipient.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

    await recipient.goto('/app/es/example/vault');

    await expect(recipient.getByRole('heading', { name: 'Descarga local cifrada', exact: true })).toBeVisible();

    await expect(recipient.getByRole('button', { name: 'Configurar mi bóveda', exact: true })).toBeVisible();

    await expect(recipient.getByRole('button', { name: 'Descargar respaldo cifrado', exact: true })).toHaveCount(0);

    await expect(recipient.locator('pre')).toHaveCount(0);
  } finally {
    await second.close();
  }

  await page.getByLabel('Local unlock PIN', { exact: true }).fill(pin);

  await page.getByRole('button', { name: 'Unlock with PIN', exact: true }).click();

  await page.getByRole('button', { name: 'Open the example note', exact: true }).click();

  await expect(page.getByText(sample, { exact: true })).toBeVisible();

  expect(requests).toEqual([]);
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

  test('adds native PRF to a PIN vault and reopens the same note with either method', async ({ page }) => {
    await signup(page);

    await seedPinVault(page);

    await registerVirtualPasskey(page, true);

    const writes = watchApiWrites(page);

    await page.getByRole('button', { name: 'Add passkey' }).click();

    await verifyIfNeeded(page, page.getByText('Passkey added. You can still unlock with your PIN.'));

    await provePasskeyUnlock(page);

    await page.getByRole('button', { name: 'Lock private resources' }).click();

    const pin = page.getByLabel('Local unlock PIN', { exact: true });

    await expect(pin).toHaveCount(0);

    await page.getByRole('button', { name: 'Use a local PIN' }).click();

    await pin.fill('048260');

    await page.getByRole('button', { name: 'Unlock with PIN' }).click();

    await expect(page.getByRole('alert')).toHaveText(/This PIN couldn’t unlock your vault/);

    await expect(page.getByText('Sample note: Garden workshop at 10:00.')).toHaveCount(0);

    await unlockOriginalPin(page);

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
  await simulatePrf(page, 'setup');

  await signup(page);

  await page.goto('/app/es/example/vault');

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

test('simulates failed and cancelled PIN vault enrollment, logout, and successful retry', async ({ page }) => {
  const email = await signup(page);

  await seedPinVault(page);

  await simulatePrf(page, 'add');

  await page.reload();

  await unlockOriginalPin(page);

  const add = page.getByRole('button', { name: 'Add passkey' });
  const verify = page.getByRole('button', { name: 'Verify passkey' });
  const alert = page.getByRole('alert');

  await add.click();

  await expect(alert).toHaveText('Passkey addition canceled. You can try again.');

  await expect(page.getByText('Sample note: Garden workshop at 10:00.')).toBeVisible();

  await add.click();

  await expect(alert).toHaveText('This passkey can’t unlock your vault. Try another passkey.');

  await add.click();

  await verify.click();

  await expect(alert).toHaveText('We couldn’t add the passkey. Try again.');

  await expect(page.getByText('Sample note: Garden workshop at 10:00.')).toBeVisible();

  await verify.click();

  await expect(page.locator('html')).toHaveAttribute('data-synthetic-prf', 'pending');

  await logout(page);

  await passwordStart(page, email);

  const code = await readMailCode(email);

  await page.getByLabel('Verification code', { exact: true }).fill(code);

  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

  await page.goto('/app/en/example/vault');

  await expect(page.getByRole('button', { name: 'Unlock with a passkey' })).toHaveCount(0);

  await unlockOriginalPin(page);

  await page.evaluate(() => sessionStorage.setItem('synthetic-prf-success', 'true'));

  await add.click();

  await verify.click();

  await expect(page.getByText('Passkey added. You can still unlock with your PIN.')).toBeVisible();

  await provePasskeyUnlock(page);
});

async function simulatePrf(page: Page, scenario: 'setup' | 'add'): Promise<void> {
  await page.addInitScript((scenario) => {
    let discovery = 0;
    let verification = 0;

    Object.defineProperty(navigator, 'userActivation', { value: { isActive: false } });
    Object.defineProperty(navigator, 'credentials', {
      value: {
        async get({ publicKey, signal }: CredentialRequestOptions) {
          if (!publicKey) {
            throw new Error('The test expects a public key request');
          }

          const discovering = !publicKey.allowCredentials?.length;
          const attempt = discovering ? ++discovery : ++verification;

          const successful = sessionStorage.getItem('synthetic-prf-success') === 'true';
          const adding = scenario === 'add';

          if (!successful && attempt === 1 && (discovering || !adding)) {
            throw new DOMException('Synthetic cancellation', 'NotAllowedError');
          }

          if (!successful && ((!adding && discovering && attempt === 2) || (adding && !discovering && attempt === 1))) {
            throw new DOMException('Synthetic transport failure', 'UnknownError');
          }

          if (!successful && adding && !discovering && attempt === 2) {
            document.documentElement.dataset['syntheticPrf'] = 'pending';

            signal?.throwIfAborted();

            await new Promise<never>((_resolve, reject) => {
              signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
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
            getClientExtensionResults: () =>
              !successful && adding && discovering && attempt === 2 ? {} : { prf: { results: { first } } },
          };
        },
      },
    });
  }, scenario);
}

async function seedPinVault(page: Page): Promise<void> {
  await page.goto('/app/en/example/vault');

  const setup = page.getByRole('button', { name: 'Set up my vault' });

  await expect(setup).toBeVisible();

  await page.evaluate(() => Object.defineProperty(navigator, 'credentials', { value: undefined, configurable: true }));

  await setup.click();

  await page.getByRole('button', { name: 'Use a local PIN' }).click();

  await page.getByLabel('Local unlock PIN', { exact: true }).fill('048261');

  await page.getByLabel('Confirm your new PIN').fill('048261');

  await page.getByRole('button', { name: 'Set up the example vault' }).click();

  await page.getByRole('button', { name: 'Open the example note' }).click();

  await expect(page.getByText('Sample note: Garden workshop at 10:00.')).toBeVisible();

  await page.evaluate(() => Reflect.deleteProperty(navigator, 'credentials'));
}

async function unlockOriginalPin(page: Page): Promise<void> {
  await page.getByLabel('Local unlock PIN', { exact: true }).fill('048261');

  await page.getByRole('button', { name: 'Unlock with PIN' }).click();

  await page.getByRole('button', { name: 'Open the example note' }).click();

  await expect(page.getByText('Sample note: Garden workshop at 10:00.')).toBeVisible();
}

async function beginVirtualPasskeySetup(page: Page, hasPrf: boolean): Promise<string[]> {
  await signup(page);

  await registerVirtualPasskey(page, hasPrf);

  const writes = watchApiWrites(page);

  await page.goto('/app/en/example/vault');

  await page.getByRole('button', { name: 'Set up my vault' }).click();

  return writes;
}

function watchApiWrites(page: Page): string[] {
  const writes: string[] = [];

  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;

    if (path.startsWith('/api/') && request.method() !== 'GET') {
      writes.push(path);
    }
  });

  return writes;
}

async function registerVirtualPasskey(page: Page, hasPrf: boolean): Promise<void> {
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
}

async function finishPasskeySetup(page: Page): Promise<void> {
  await verifyIfNeeded(page, page.getByRole('button', { name: 'Open the example note' }));
}

async function verifyIfNeeded(page: Page, settled: Locator): Promise<void> {
  const verify = page.getByRole('button', { name: 'Verify passkey', disabled: false });

  await expect(verify.or(settled)).toBeVisible();

  const needsVerification = await verify.isVisible();

  if (needsVerification) {
    await verify.click();
  }

  await expect(settled).toBeVisible();
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
