import { buffer as readStream } from 'node:stream/consumers';

import type { Page } from '@playwright/test';
import { readMailCode } from '@visomi-stack/dev-testing';

import {
  expect,
  passwordStart,
  saveRecoveryKey,
  signup,
  test,
  virtualPasskey,
  vaultUnlockUrl,
} from './support/fixtures';

const directory = '/app/en/db-example/vault';
const pin = '048261';
const localPin = (page: Page) => page.getByLabel('Local unlock PIN', { exact: true });
const confirmPin = (page: Page) => page.getByLabel('Confirm your new PIN', { exact: true });

async function chooseRecoveryPin(page: Page) {
  const alternative = page.getByRole('button', { name: 'Use a PIN instead', exact: true });

  await expect(alternative.or(localPin(page))).toBeVisible();

  const visible = await alternative.isVisible();

  if (visible) {
    await alternative.click();
  }
}

async function beginVault(page: Page, label: string) {
  await page.goto(directory);

  await page.getByRole('button', { name: label, exact: true }).click();

  await page.getByRole('button', { name: /^Use a PIN (on this device|instead)$/ }).click();

  await localPin(page).fill(pin);

  await confirmPin(page).fill(pin);

  await page.getByRole('button', { name: 'Set up with PIN', exact: true }).click();

  await expect(page.getByRole('button', { name: 'I saved my recovery key' })).toBeDisabled();
}

async function makeVault(page: Page, label: string, note: string) {
  await beginVault(page, label);

  const download = await saveRecoveryKey(page);

  await expect(page.locator('app-vault-sync-indicator').getByRole('status')).toHaveText('Vault synced');

  const [stored] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/sync/push')),
    page.getByLabel('Your note', { exact: true }).fill(note),
  ]);

  expect(stored.ok()).toBe(true);

  await expect(page.locator('app-vault-sync-indicator').getByRole('status')).toHaveText('Vault synced');

  const stream = await download.createReadStream();
  const buffer = await readStream(stream);

  expect(buffer.toString('utf8').startsWith('# Visomi Vault recovery key\n')).toBe(true);

  return { url: page.url(), file: { name: download.suggestedFilename(), mimeType: 'text/plain', buffer } };
}

test('recovers with the original profile gone and deletes only the selected vault', async ({ page, browser }, info) => {
  const email = await signup(page);
  const first = await makeVault(page, 'Set up my vault', 'Synthetic first vault note');
  const other = await makeVault(page, 'Create another vault', 'Synthetic independent note');
  const firstId = new URL(first.url).searchParams.get('scopeId')!;
  const otherId = new URL(other.url).searchParams.get('scopeId')!;

  expect(firstId).not.toBe(otherId);

  // Closing the entire original browser context drops open keys, cookies and local storage.
  await page.context().close();

  const fresh = await browser.newContext({ baseURL: info.project.use.baseURL });

  try {
    const peer = await fresh.newPage();

    const identity = /^Identity: (.+)$/m.exec(first.file.buffer.toString('utf8'))?.[1] ?? '';

    expect(identity.length).toBeGreaterThan(0);

    let sentPrivateMaterial = false;

    peer.on('request', (request) => {
      const body = request.postData();

      if (
        body &&
        (body.includes(identity) ||
          /visomi\.vault-recovery\.v2|"048261"|Synthetic first vault note|Synthetic independent note/.test(body))
      ) {
        sentPrivateMaterial = true;
      }
    });

    await passwordStart(peer, email);

    const code = await readMailCode(email);

    await peer.getByLabel('Verification code', { exact: true }).fill(code);

    await expect(peer.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

    await peer.goto(first.url);

    await peer.getByRole('link', { name: 'Link a device', exact: true }).click();

    await peer.getByText('Recover with a saved key', { exact: true }).click();

    const file = peer.getByLabel('Vault recovery key file', { exact: true });
    const recover = peer.getByRole('button', { name: 'Recover with PIN', exact: true });

    await file.setInputFiles({ ...first.file, buffer: Buffer.from('{"format":"visomi.vault-recovery.v1"}') });

    await chooseRecoveryPin(peer);

    await localPin(peer).fill(pin);

    await confirmPin(peer).fill(pin);

    await recover.click();

    await expect(peer.getByRole('status').filter({ hasText: 'This device doesn’t have a usable key' })).toBeVisible();

    await file.setInputFiles(other.file);

    await localPin(peer).fill(pin);

    await confirmPin(peer).fill(pin);

    await recover.click();

    await expect(peer.getByRole('status').filter({ hasText: 'This device doesn’t have a usable key' })).toBeVisible();

    await file.setInputFiles(first.file);

    // The server commits the approval, but the recipient never gets its reply.
    await peer.route(
      '**/devices/approve',
      async (route) => {
        const committed = await route.fetch();

        expect(committed.ok()).toBe(true);

        await route.abort('failed');
      },
      { times: 1 },
    );

    await localPin(peer).fill(pin);

    await confirmPin(peer).fill(pin);

    await recover.click();

    await expect(peer.getByRole('status').filter({ hasText: 'Private storage is unavailable' })).toBeVisible();

    await localPin(peer).fill('371054');

    await confirmPin(peer).fill('371054');

    await recover.click();

    await expect(
      peer.getByRole('status').filter({ hasText: /couldn’t verify|Private storage is unavailable/ }),
    ).toBeVisible();

    await expect(peer.getByRole('link', { name: 'Open vault note', exact: true })).toHaveCount(0);

    await localPin(peer).fill(pin);

    await confirmPin(peer).fill(pin);

    await recover.click();

    await peer.getByRole('link', { name: 'Open vault note', exact: true }).click();

    await expect(peer.getByLabel('Your note', { exact: true })).toHaveValue('Synthetic first vault note');

    await peer.reload();

    await expect(peer).toHaveURL(vaultUnlockUrl(first.url));

    await localPin(peer).fill(pin);

    await expect(peer.getByLabel('Your note', { exact: true })).toHaveValue('Synthetic first vault note');

    await peer.goto(directory);

    const otherRow = peer.getByRole('listitem').filter({ hasText: otherId });

    await otherRow.getByRole('button', { name: 'Delete vault', exact: true }).click();

    await otherRow.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(otherRow.getByRole('button', { name: /Open vault/ })).toBeVisible();

    await otherRow.getByRole('button', { name: 'Delete vault', exact: true }).click();

    await otherRow.getByRole('button', { name: 'Permanently delete this vault', exact: true }).click();

    await expect(otherRow).toHaveCount(0);

    await peer
      .getByRole('listitem')
      .filter({ hasText: firstId })
      .getByRole('button', { name: /Open vault/ })
      .click();

    await expect(peer).toHaveURL(vaultUnlockUrl(first.url));

    await localPin(peer).fill(pin);

    await expect(peer.getByLabel('Your note', { exact: true })).toHaveValue('Synthetic first vault note');

    expect(sentPrivateMaterial).toBe(false);
  } finally {
    await fresh.close();
  }
});

test('enrolls recovery on an existing vault and restores it with an existing passkey', async ({
  page,
  browser,
  browserName,
}, info) => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(browserName !== 'chromium', 'Requires a Chromium virtual PRF authenticator');

  await page.addInitScript(() => Object.defineProperty(navigator, 'credentials', { value: undefined }));

  const email = await signup(page);

  // Older clients sent a single bootstrap proof and had no recovery recipient.
  await page.route(
    '**/devices/bootstrap',
    async (route) => {
      const response = await route.fetch({ postData: route.request().postDataJSON().primary });

      await route.fulfill({ response });
    },
    { times: 1 },
  );

  const vault = await makeVault(page, 'Set up my vault', 'Synthetic legacy note');

  await page.getByText('Recovery key', { exact: true }).click();

  await page.getByLabel('Confirm local PIN', { exact: true }).fill(pin);

  await page.getByRole('button', { name: 'Set up a recovery key', exact: true }).click();

  const saved = await saveRecoveryKey(page);

  await expect(page.getByText('Your recovery key is ready to use.', { exact: true })).toBeVisible();

  const updated = 'Synthetic edit after enrolling recovery';
  const [publication] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/sync/push')),
    page.getByLabel('Your note', { exact: true }).fill(updated),
  ]);

  expect(publication.ok()).toBe(true);

  await expect(page.locator('app-vault-sync-indicator').getByRole('status')).toHaveText('Vault synced');

  const stream = await saved.createReadStream();
  const buffer = await readStream(stream);

  await page.context().close();

  const fresh = await browser.newContext({ baseURL: info.project.use.baseURL });

  try {
    const peer = await fresh.newPage();
    const { credentialIds } = await virtualPasskey(peer);

    await passwordStart(peer, email);

    const code = await readMailCode(email);

    await peer.getByLabel('Verification code', { exact: true }).fill(code);

    await expect(peer.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

    await peer.goto('/app/en/security/passkeys');

    await peer.getByRole('button', { name: 'Add a passkey', exact: true }).click();

    await expect(peer.getByRole('status').filter({ hasText: 'Passkey added.' })).toBeVisible();

    const enrolled = await credentialIds();

    await peer.goto(vault.url);

    await peer.getByRole('link', { name: 'Link a device', exact: true }).click();

    await peer.getByText('Recover with a saved key', { exact: true }).click();

    await peer
      .getByLabel('Vault recovery key file', { exact: true })
      .setInputFiles({ name: 'synthetic-recovery.txt', mimeType: 'text/plain', buffer });

    await peer.getByRole('button', { name: 'Recover with a passkey', exact: true }).click();

    await peer.getByRole('link', { name: 'Open vault note', exact: true }).click();

    await expect(peer.getByLabel('Your note', { exact: true })).toHaveValue(updated);

    const after = await credentialIds();

    expect(after).toEqual(enrolled);
  } finally {
    await fresh.close();
  }
});

test('recovers a competing setup using one deliberately created passkey after cancellation', async ({
  page,
  browser,
  browserName,
}, info) => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(browserName !== 'chromium', 'Uses the Chromium virtual authenticator credential inventory');
  test.slow();
  const email = await signup(page);

  await beginVault(page, 'Set up my vault');

  const other = await browser.newContext({
    baseURL: info.project.use.baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': '198.19.120.7' },
  });

  try {
    const peer = await other.newPage();
    const { credentialIds } = await virtualPasskey(peer);

    await passwordStart(peer, email);

    const code = await readMailCode(email);

    await peer.getByLabel('Verification code', { exact: true }).fill(code);

    await expect(peer.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

    await beginVault(peer, 'Continue vault setup');

    expect(peer.url()).toBe(page.url());

    const winner = await saveRecoveryKey(page);

    await expect(page.locator('app-vault-sync-indicator').getByRole('status')).toHaveText('Vault synced');

    const note = 'Synthetic winning setup';

    const [stored] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/sync/push')),
      page.getByLabel('Your note', { exact: true }).fill(note),
    ]);

    expect(stored.ok()).toBe(true);

    await expect(page.locator('app-vault-sync-indicator').getByRole('status')).toHaveText('Vault synced');

    const [loser] = await Promise.all([
      peer.waitForResponse((response) => response.url().endsWith('/devices/bootstrap')),
      saveRecoveryKey(peer),
    ]);

    expect(loser.status()).toBe(409);

    await peer.goto(page.url());

    const security = await peer.getByRole('link', { name: 'Link a device', exact: true }).getAttribute('href');

    await peer.route('**/example/cloud/policy', (route) => route.abort());

    await peer.goto(security!);

    await peer.getByText('Recover with a saved key', { exact: true }).click();

    const stream = await winner.createReadStream();
    const recoveryBytes = await readStream(stream);

    await peer.getByLabel('Vault recovery key file', { exact: true }).setInputFiles({
      name: 'synthetic-recovery.txt',
      mimeType: 'text/plain',
      buffer: recoveryBytes,
    });

    await peer.getByText('Other passkey options', { exact: true }).click();

    await peer.evaluate(() => {
      const original = navigator.credentials.get.bind(navigator.credentials);

      Object.defineProperty(navigator.credentials, 'get', {
        configurable: true,
        value: async () => {
          Object.defineProperty(navigator.credentials, 'get', { configurable: true, value: original });

          throw new DOMException('Synthetic cancellation', 'NotAllowedError');
        },
      });
    });

    const create = peer.getByRole('button', { name: 'Create a new passkey for this device', exact: true });

    await create.click();

    await expect(peer.getByRole('status').filter({ hasText: 'Unlock canceled' })).toBeVisible();

    const afterCreate = await credentialIds();

    expect(afterCreate).toHaveLength(1);

    await peer.getByRole('button', { name: 'Continue with this device’s passkey', exact: true }).click();

    await peer.getByRole('link', { name: 'Open vault note', exact: true }).click();

    await expect(peer.getByLabel('Your note', { exact: true })).toHaveValue(note);

    const afterRetry = await credentialIds();

    expect(afterRetry).toEqual(afterCreate);
  } finally {
    await other.close();
  }
});
