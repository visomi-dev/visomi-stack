import type { Request } from '@playwright/test';
import { readMailCode } from '@visomi-stack/dev-testing';

import { expect, test, signup, logout, passwordStart } from './support/fixtures';

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

  await page.getByRole('button', { name: 'Create a test workspace', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Operational note · service-readable', exact: true })).toBeVisible();

  const workspace = page.url();

  await expect(page.getByLabel('Local unlock PIN', { exact: true })).toHaveCount(0);

  await page.getByLabel('Operational content', { exact: true }).fill(cloudMarker);

  await page.getByRole('button', { name: 'Save operational note', exact: true }).click();

  await expect(page.getByRole('status')).toContainText(['Saved the note. The server can read it.']);

  await page.getByRole('button', { name: 'Set up an empty private resource', exact: true }).click();

  await expect(page.getByLabel('Private text', { exact: true })).toBeEnabled();

  await context.setOffline(true);

  await page.getByLabel('Private text', { exact: true }).fill(privateMarker);

  await page.getByRole('button', { name: 'Save encrypted change', exact: true }).click();

  await expect(page.locator('pre')).toHaveText(privateMarker);

  await expect(page.getByText('An encrypted change is waiting to sync.', { exact: false })).toBeVisible();

  await context.setOffline(false);

  await page.getByRole('button', { name: 'Synchronize encrypted changes', exact: true }).click();

  await expect(page.getByLabel('Private text', { exact: true })).toBeEnabled();

  expect(transport.join('\n')).toContain(cloudMarker);
  expect(transport.join('\n')).not.toContain(privateMarker);

  await page.reload();

  await expect(page.getByLabel('Operational content', { exact: true })).toHaveValue(cloudMarker);

  await expect(page.getByText('Private resources are locked.', { exact: true })).toBeVisible();

  await expect(page.locator('pre')).toHaveCount(0);

  await page.getByRole('button', { name: 'Unlock with a passkey', exact: true }).click();

  await expect(page.locator('pre')).toHaveText(privateMarker);

  await page.getByRole('button', { name: 'Lock private resources', exact: true }).click();

  await expect(page.locator('pre')).toHaveCount(0);

  await page.getByRole('button', { name: 'Unlock with a passkey', exact: true }).click();

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

  const unlock = page.getByRole('button', { name: 'Desbloquear con una clave de acceso', exact: true });

  await expect(unlock).toBeEnabled();

  await unlock.focus();

  await expect(unlock).toBeFocused();

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

  await page.getByRole('button', { name: 'Unlock with a passkey', exact: true }).click();

  await expect(page.locator('pre')).toHaveText(privateMarker);

  await logout(page);

  await page.goto(workspace);

  await expect(page.getByRole('heading', { name: 'Sign-in options', exact: true })).toBeVisible();

  await expect(page.getByText(privateMarker, { exact: true })).toHaveCount(0);
});

test('SPA resource navigation and browser history isolate views and retain only the correct encrypted outbox', async ({
  page,
  context,
}) => {
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

  async function workspace(body: string) {
    await page.goto('/app/en/persistence');

    await page.getByRole('button', { name: 'Create a test workspace', exact: true }).click();

    await expect(page.getByLabel('Operational content', { exact: true })).toBeEnabled();

    await page.getByLabel('Operational content', { exact: true }).fill(body);

    await page.getByRole('button', { name: 'Save operational note', exact: true }).click();

    await expect(page.getByRole('status')).toContainText(['Saved the note. The server can read it.']);

    return new URL(page.url()).pathname;
  }

  const a = await workspace('Synthetic cloud A');

  await page.getByRole('button', { name: 'Set up an empty private resource', exact: true }).click();

  await expect(page.getByLabel('Private text', { exact: true })).toBeEnabled();

  await context.setOffline(true);

  await page.getByLabel('Private text', { exact: true }).fill('SYNTHETIC_PRIVATE_ROUTE_A');

  await page.getByRole('button', { name: 'Save encrypted change', exact: true }).click();

  await expect(page.locator('pre')).toHaveText('SYNTHETIC_PRIVATE_ROUTE_A');

  await context.setOffline(false);

  const b = await workspace('Synthetic cloud B');

  await page.getByRole('button', { name: 'Set up an empty private resource', exact: true }).click();

  await expect(page.getByLabel('Private text', { exact: true })).toBeEnabled();

  await page.getByLabel('Private text', { exact: true }).fill('Unfinished B draft');

  await page.evaluate((path) => {
    document.body.dataset['syntheticSpa'] = 'same-document';
    history.pushState(null, '', path);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
  }, a);

  await expect(page.getByLabel('Operational content', { exact: true })).toHaveValue('Synthetic cloud A');

  await expect(page.locator('body')).toHaveAttribute('data-synthetic-spa', 'same-document');

  await expect(page.getByText('Private resources are locked.', { exact: true })).toBeVisible();

  await expect(page.locator('pre')).toHaveCount(0);

  await page.getByRole('button', { name: 'Unlock with a passkey', exact: true }).click();

  await expect(page.locator('pre')).toHaveText('SYNTHETIC_PRIVATE_ROUTE_A');

  await expect(page.getByLabel('Private text', { exact: true })).toHaveValue('');

  const ciphertextOnly = await page.evaluate(async () => {
    const names = await indexedDB.databases();
    let safe = true;
    let databases = 0;

    for (const { name } of names) {
      if (!name?.startsWith('visomi-vault:') && !name?.startsWith('visomi-sync:')) {
        continue;
      }

      databases++;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      for (const store of db.objectStoreNames) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).getAll();

          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        safe &&= !JSON.stringify(rows).includes('SYNTHETIC_PRIVATE_ROUTE_A');
      }
      db.close();
    }

    return { safe, databases };
  });

  expect(ciphertextOnly).toEqual({ safe: true, databases: 2 });

  await page.goBack();

  await expect(page).toHaveURL(new RegExp(`${b}$`));

  await expect(page.getByLabel('Operational content', { exact: true })).toHaveValue('Synthetic cloud B');

  await expect(page.locator('pre')).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Unlock with a passkey', exact: true })).toHaveCount(0);

  await expect(page.getByLabel('Private text', { exact: true })).toHaveValue('');

  await expect(page.locator('pre')).toHaveCount(0);

  await page.goForward();

  await expect(page.getByLabel('Operational content', { exact: true })).toHaveValue('Synthetic cloud A');

  await expect(page.getByRole('button', { name: 'Unlock with a passkey', exact: true })).toHaveCount(0);

  await expect(page.locator('pre')).toHaveText('SYNTHETIC_PRIVATE_ROUTE_A');

  await page.getByRole('button', { name: 'Synchronize encrypted changes', exact: true }).click();

  await expect(page.getByLabel('Private text', { exact: true })).toBeEnabled();
});

function persistenceRequestBody(request: Request): string {
  return request.url().includes('/api/persistence/') ? (request.postData() ?? '') : '';
}

test('pairs a test private resource in Security across a PIN device and a PRF device', async ({
  page,
  context,
  browser,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true });
  });

  let privateRequestCount = 0;
  let observedLocalSecret = false;
  const observe = (request: Request) => {
    const payload = persistenceRequestBody(request);

    privateRequestCount += Number(Boolean(payload));
    observedLocalSecret ||= /"(?:048261|SYNTHETIC_PAIRING_[^"]*)"|"(?:pin|prf|methodId|secret)"\s*:/.test(
      payload || '',
    );
  };

  page.on('request', observe);
  const email = await signup(page);

  await page.goto('/app/en/persistence');

  await page.getByRole('button', { name: 'Create a test workspace', exact: true }).click();

  const pin = page.getByLabel('Local unlock PIN', { exact: true });

  await expect(pin).toBeVisible();

  const workspace = page.url();

  await pin.fill('048261');

  await page.getByLabel('Confirm your new PIN', { exact: true }).fill('048261');

  await page.getByRole('button', { name: 'Set up an empty private resource with PIN', exact: true }).click();

  const first = 'SYNTHETIC_PAIRING_EXISTING_NOTE';
  const second = 'SYNTHETIC_PAIRING_UPDATED_NOTE';

  await page.getByLabel('Private text', { exact: true }).fill(first);

  await page.getByRole('button', { name: 'Save encrypted change', exact: true }).click();

  await expect(page.locator('pre')).toHaveText(first);

  await page.getByRole('button', { name: 'Synchronize encrypted changes', exact: true }).click();

  await expect(page.getByLabel('Private text', { exact: true })).toBeEnabled();

  await page.getByRole('link', { name: 'Vault devices', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Vault devices', exact: true })).toBeVisible();

  const signer = page.locator('[data-vault-approver]');

  await expect(signer).toHaveText(/^[A-Za-z0-9_-]{43}$/);

  const approverFingerprint = await signer.innerText();
  const pairingPage = page.url();
  const recipientContext = await browser.newContext({ baseURL: pairingPage, viewport: { width: 390, height: 844 } });

  try {
    const recipient = await recipientContext.newPage();

    recipient.on('request', observe);
    const cdp = await recipientContext.newCDPSession(recipient);

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

    await passwordStart(recipient, email);

    const factor = await readMailCode(email);

    await recipient.getByLabel('Verification code', { exact: true }).fill(factor);

    await expect(recipient.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

    await recipient.goto(workspace);

    await expect(recipient.locator('pre')).toHaveCount(0);

    await expect(recipient.getByText(first, { exact: true })).toHaveCount(0);

    await recipient.route('**/api/persistence/policy', (route) => route.fulfill({ status: 404 }));

    const absent = recipient.waitForResponse('**/api/persistence/policy');

    await recipient.goto(pairingPage);

    await absent;

    await expect(recipient.getByRole('heading', { name: 'Security', exact: true })).toBeVisible();

    await expect(recipient.getByRole('heading', { name: 'Vault devices', exact: true })).toHaveCount(0);

    await recipient.unroute('**/api/persistence/policy');

    await recipient.goto(pairingPage.replace('/app/en/', '/app/es/'));

    await expect(recipient.getByRole('heading', { name: 'Dispositivos del vault', exact: true })).toBeVisible();

    await recipient.goto(pairingPage);

    await expect(recipient.getByLabel('Local unlock PIN', { exact: true })).toHaveCount(0);

    const requestPasskey = recipient.getByRole('button', { name: 'Request pairing with a passkey', exact: true });

    await expect(requestPasskey).toBeEnabled();

    await recipient.evaluate(() => {
      Object.defineProperty(navigator.credentials, 'create', {
        configurable: true,
        value: () => Promise.reject(new DOMException('Synthetic cancellation', 'NotAllowedError')),
      });
    });

    await requestPasskey.click();

    await expect(recipient.getByRole('status')).toContainText(['Unlock canceled.']);

    await expect(recipient.getByLabel('Local unlock PIN', { exact: true })).toHaveCount(0);

    await recipient.evaluate(() => Reflect.deleteProperty(navigator.credentials, 'create'));

    await requestPasskey.click();

    const request = recipient.getByLabel('Pairing request', { exact: true });
    const fingerprint = recipient.locator('[data-vault-recipient]');

    await expect(request).toHaveValue(/^\{/);

    await expect(fingerprint).toHaveText(/^[A-Za-z0-9_-]{43}$/);

    const token = await request.inputValue();
    const recipientFingerprint = await fingerprint.innerText();
    const fingerprintInput = page.getByLabel('New device fingerprint', { exact: true });
    const approve = page.getByRole('button', { name: 'Approve this device', exact: true });

    await page.getByLabel('Pairing request', { exact: true }).fill(token);

    await fingerprintInput.fill(approverFingerprint);

    await approve.click();

    await expect(page.getByRole('status')).toContainText(['The fingerprints don’t match.']);

    await fingerprintInput.fill(recipientFingerprint);

    await approve.click();

    await expect(page.getByRole('status')).toContainText(['Device approved.']);

    const trust = recipient.getByLabel('Approving device fingerprint', { exact: true });
    const finish = recipient.getByRole('button', { name: 'Finish pairing', exact: true });

    await trust.fill(recipientFingerprint);

    await finish.click();

    await expect(recipient.getByRole('status')).toContainText(['The fingerprints don’t match.']);

    await expect(recipient.getByRole('link', { name: 'Open test private resource', exact: true })).toHaveCount(0);

    await trust.fill(approverFingerprint);

    await finish.click();

    await recipient.getByRole('link', { name: 'Open test private resource', exact: true }).click();

    await recipient.getByRole('button', { name: 'Synchronize encrypted changes', exact: true }).click();

    await expect(recipient.locator('pre')).toHaveText(first);

    await recipient.getByLabel('Private text', { exact: true }).fill(second);

    await recipient.getByRole('button', { name: 'Save encrypted change', exact: true }).click();

    await expect(recipient.locator('pre')).toHaveText(second);

    await recipient.getByRole('button', { name: 'Synchronize encrypted changes', exact: true }).click();

    await expect(recipient.getByLabel('Private text', { exact: true })).toBeEnabled();

    await recipient.getByRole('button', { name: 'Lock private resources', exact: true }).click();

    await expect(recipient.getByLabel('Local unlock PIN', { exact: true })).toHaveCount(0);

    await recipient.getByRole('button', { name: 'Unlock with a passkey', exact: true }).click();

    await expect(recipient.locator('pre')).toHaveText(second);

    await page.goto(workspace);

    await pin.fill('048261');

    await page.getByRole('button', { name: 'Unlock with PIN', exact: true }).click();

    await page.getByRole('button', { name: 'Synchronize encrypted changes', exact: true }).click();

    await expect(page.locator('pre')).toHaveText(second);

    expect(privateRequestCount).toBeGreaterThan(0);
    expect(observedLocalSecret).toBe(false);
  } finally {
    await recipientContext.close();
  }
});
