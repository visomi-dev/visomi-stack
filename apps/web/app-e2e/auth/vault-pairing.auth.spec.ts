import type { Page, Request } from '@playwright/test';
import { readMailCode } from '@visomi-stack/dev-testing';

import {
  expect,
  test,
  signup,
  passwordStart,
  vaultUnlockUrl,
  expireVaultPairing,
  virtualPasskey,
  saveRecoveryKey,
} from './support/fixtures';

const reviewNotice = (page: Page, url: URL) =>
  page
    .getByRole('link', { name: 'Review request', exact: true })
    .and(page.locator(`[href="${url.pathname}${url.search}"]`));

async function selectPairingPin(page: Page) {
  const localPin = page.getByLabel('Local unlock PIN', { exact: true });
  const requestWithPasskey = page.getByRole('button', { name: 'Request pairing with a passkey', exact: true });

  // The passkey button is disabled while the browser's capability check is pending.
  await expect(localPin.or(requestWithPasskey)).toBeEnabled();

  const alternative = page.getByRole('button', { name: 'Use a PIN instead', exact: true });
  const visible = await alternative.isVisible();

  if (visible) {
    await alternative.click();
  }
}

function containsPrivateMaterial(request: Request, note: string, approverPin: string, recipientPin: string) {
  const body = request.postData() ?? '';

  return (
    request.url().includes('/api/example/vault/') &&
    (body.includes(note) ||
      body.includes(JSON.stringify(approverPin)) ||
      body.includes(JSON.stringify(recipientPin)) ||
      /"(?:pin|prf|methodId|secret|material|pairingCode|code)"\s*:/.test(body))
  );
}

test('pairs two PIN-only devices with a new 8-digit code after a wrong attempt', async ({
  page,
  context,
  browser,
}, info) => {
  test.slow();

  await context.setExtraHTTPHeaders({ 'x-forwarded-for': '198.19.127.1' });

  const approverPin = '048261';
  const recipientPin = '208146';
  const note = 'Synthetic note shared between two PIN-only devices';
  let sentPrivateMaterial = false;
  const observe = (request: Request) => {
    sentPrivateMaterial ||= containsPrivateMaterial(request, note, approverPin, recipientPin);
  };

  page.on('request', observe);
  const email = await signup(page);

  await page.goto('/app/en/db-example/vault');

  await page.getByRole('button', { name: 'Set up my vault', exact: true }).click();

  await page.getByRole('button', { name: /^Use a PIN (on this device|instead)$/ }).click();

  await page.getByLabel('Local unlock PIN', { exact: true }).fill(approverPin);

  await page.getByLabel('Confirm your new PIN', { exact: true }).fill(approverPin);

  await page.getByRole('button', { name: 'Set up with PIN', exact: true }).click();

  await saveRecoveryKey(page);

  const syncStatus = page.locator('app-vault-sync-indicator').getByRole('status');

  await expect(syncStatus).toHaveText('Vault synced');

  const [publication] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/sync/push')),
    page.getByLabel('Your note', { exact: true }).fill(note),
  ]);

  expect(publication.ok()).toBe(true);

  await expect(syncStatus).toHaveText('Vault synced');

  const workspace = page.url();

  await page.getByRole('link', { name: 'Link a device', exact: true }).click();

  const desktop = await browser.newContext({
    baseURL: info.project.use.baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': '198.19.127.2' },
  });

  try {
    const peer = await desktop.newPage();

    peer.on('request', observe);

    await passwordStart(peer, email);

    const emailCode = await readMailCode(email);

    await peer.getByLabel('Verification code', { exact: true }).fill(emailCode);

    await expect(peer.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

    await peer.goto(workspace);

    await peer.getByRole('link', { name: 'Link a device', exact: true }).click();

    await selectPairingPin(peer);

    const localPin = peer.getByLabel('Local unlock PIN', { exact: true });
    const displayedCode = peer.getByLabel('Pairing code', { exact: true });
    const reviewLink = peer.getByRole('link', { name: 'Open review link', exact: true });
    const openNote = peer.getByRole('link', { name: 'Open vault note', exact: true });
    const requestPairing = async () => {
      await localPin.fill(recipientPin);

      await peer.getByLabel('Confirm your new PIN', { exact: true }).fill(recipientPin);

      await peer.getByRole('button', { name: 'Request pairing with PIN', exact: true }).click();

      await expect(displayedCode).toHaveText(/^[0-9]{4} [0-9]{4}$/);

      const code = await displayedCode.innerText();
      const href = await reviewLink.getAttribute('href');
      const url = new URL(href!);

      await reviewNotice(page, url).click();

      await expect(page).toHaveURL(url.href);

      return { code, url };
    };
    const approve = async (code: string) => {
      await page.getByLabel('Pairing code', { exact: true }).fill(code);

      await page.getByLabel('Confirm local PIN', { exact: true }).fill(approverPin);

      await page.getByRole('button', { name: 'Approve this device', exact: true }).click();
    };

    const first = await requestPairing();
    const wrongCode = String((Number(first.code[0]) + 1) % 10) + first.code.slice(1);

    await approve(wrongCode);

    const restart = peer.getByRole('button', { name: 'Start again', exact: true });

    // Allow the 30-second HTTP fallback if a realtime notification is missed.
    await expect(restart).toBeVisible({ timeout: 45_000 });

    await expect(displayedCode).toHaveCount(0);

    await expect(openNote).toHaveCount(0);

    await restart.click();

    const retry = await requestPairing();

    expect(retry.url.searchParams.get('requestId')).not.toBe(first.url.searchParams.get('requestId'));

    await approve(retry.code);

    await expect(page.getByRole('status').filter({ hasText: 'Device approved.' })).toBeVisible({ timeout: 45_000 });

    await expect(openNote).toBeVisible({ timeout: 45_000 });

    await openNote.click();

    const peerNote = peer.getByLabel('Your note', { exact: true });

    await expect(peerNote).toHaveValue(note);

    await peer.reload();

    await localPin.fill(recipientPin);

    await expect(peerNote).toHaveValue(note);

    expect(sentPrivateMaterial).toBe(false);
  } finally {
    await desktop.close();
  }
});

test('opens the backed note on an approved desktop with its own PIN and no passkey', async ({
  page,
  context,
  browser,
  browserName,
}, info) => {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(browserName !== 'chromium', 'Requires Chromium virtual WebAuthn PRF for the approving device');
  test.slow();

  await context.setExtraHTTPHeaders({ 'x-forwarded-for': '198.19.127.3' });

  await virtualPasskey(page);

  const email = await signup(page);

  await page.goto('/app/en/security/passkeys');

  await page.getByRole('button', { name: 'Add a passkey', exact: true }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Passkey added.' })).toBeVisible();

  await page.goto('/app/en/db-example/vault');

  await page.getByRole('button', { name: 'Set up my vault' }).click();

  await page.getByRole('button', { name: 'Set up with a passkey' }).click();

  await saveRecoveryKey(page);

  const note = 'Synthetic note from the first linked device';
  const [publication] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/sync/push')),
    page.getByLabel('Your note', { exact: true }).fill(note),
  ]);

  expect(publication.ok()).toBe(true);

  await expect(page.locator('app-vault-sync-indicator').getByRole('status')).toHaveText('Vault synced');

  const workspace = page.url();

  await page.getByRole('link', { name: 'Link a device' }).click();

  const desktop = await browser.newContext({
    baseURL: info.project.use.baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': '198.19.127.4' },
  });

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

    const request = peer.getByRole('button', { name: 'Request pairing with PIN' });
    const publication = () => peer.waitForResponse((response) => response.url().endsWith('/devices/pairing'));
    const [first] = await Promise.all([publication(), request.click()]);
    const previous = first.request().postDataJSON();

    await expireVaultPairing(previous.requestId);

    const restart = peer.getByRole('button', { name: 'Start again', exact: true });

    await expect(restart).toBeVisible({ timeout: 25_000 });

    await restart.click();

    await pin.fill('208146');

    await peer.getByLabel('Confirm your new PIN').fill('208146');

    const [next] = await Promise.all([publication(), request.click()]);
    const resumedRequest = next.request().postDataJSON();

    expect(resumedRequest.requestId).not.toBe(previous.requestId);
    expect(resumedRequest.deviceId).toBe(previous.deviceId);
    expect(resumedRequest.keys).toEqual(previous.keys);

    const reviewLink = peer.getByRole('link', { name: 'Open review link', exact: true });

    await expect(reviewLink).toBeVisible();

    const href = await reviewLink.getAttribute('href');
    const relative = new URL(href!);
    const displayedCode = peer.getByLabel('Pairing code', { exact: true });
    const codeInput = page.getByLabel('Pairing code', { exact: true });
    const approveDevice = page.getByRole('button', { name: 'Approve this device' });

    const resumed = await page.context().newPage();

    await resumed.setExtraHTTPHeaders({ 'x-forwarded-for': '198.19.127.5' });

    await resumed.goto(relative.href);

    await expect(
      resumed.getByText('Unlock the note on this device before approving another one.', { exact: true }),
    ).toBeVisible();

    await reviewNotice(page, relative).click();

    await expect(displayedCode).toHaveText(/^[0-9]{4} [0-9]{4}$/);

    const pairingCode = await displayedCode.innerText();
    const wrongCode = String((Number(pairingCode[0]) + 1) % 10) + pairingCode.slice(1);

    await codeInput.fill(wrongCode);

    await approveDevice.click();

    await expect(restart).toBeVisible({ timeout: 25_000 });

    await expect(displayedCode).toHaveCount(0);

    await expect(peer.getByRole('link', { name: 'Open vault note' })).toHaveCount(0);

    await restart.click();

    await pin.fill('208146');

    await peer.getByLabel('Confirm your new PIN').fill('208146');

    const [retry] = await Promise.all([publication(), request.click()]);

    expect(retry.request().postDataJSON().requestId).not.toBe(resumedRequest.requestId);

    await expect(reviewLink).toBeVisible();

    const retryHref = await reviewLink.getAttribute('href');
    const retryUrl = new URL(retryHref!);

    await reviewNotice(page, retryUrl).click();

    await expect(page).toHaveURL(retryUrl.href);

    await expect(displayedCode).toHaveText(/^[0-9]{4} [0-9]{4}$/);

    const correctCode = await displayedCode.innerText();

    await codeInput.fill(correctCode);

    const [approval] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/devices/approve'), { timeout: 45_000 }),
      approveDevice.click(),
    ]);

    expect(approval.status()).toBe(200);

    await expect(page.getByRole('status').filter({ hasText: 'Device approved.' })).toBeVisible();

    await expect(peer.getByRole('link', { name: 'Open vault note' })).toBeVisible({ timeout: 25_000 });

    await expect(peer.getByLabel('Approving device fingerprint', { exact: true })).toHaveCount(0);

    await expect(pin).toHaveCount(0);

    await peer.getByRole('link', { name: 'Open vault note' }).click();

    await expect(peer.getByLabel('Your note', { exact: true })).toHaveValue(note);

    await peer.reload();

    await pin.fill('208146');

    await expect(peer.getByLabel('Your note', { exact: true })).toHaveValue(note);

    await resumed.close();
  } finally {
    await desktop.close();
  }
});
