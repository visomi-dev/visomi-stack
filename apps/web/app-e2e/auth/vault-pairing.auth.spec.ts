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

// eslint-disable-next-line playwright/no-skipped-test
test.skip(({ browserName }) => browserName !== 'chromium', 'Requires Chromium virtual WebAuthn PRF');

test('opens the backed note on an approved desktop with its own PIN and no passkey', async ({
  page,
  browser,
}, info) => {
  test.slow();

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
    extraHTTPHeaders: { 'x-forwarded-for': '198.19.120.1' },
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
    const fingerprint = await peer.locator('[data-vault-recipient]').innerText();
    const relative = new URL(href!);

    const resumed = await page.context().newPage();

    await resumed.setExtraHTTPHeaders({ 'x-forwarded-for': '198.19.120.2' });

    await resumed.goto(relative.href);

    await expect(
      resumed.getByText('Unlock the note on this device before approving another one.', { exact: true }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Review request', exact: true }).click();

    await expect(page).toHaveURL(relative.href);

    await page.getByLabel('New device fingerprint').fill(fingerprint);

    const [approval] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/devices/approve'), { timeout: 10_000 }),
      page.getByRole('button', { name: 'Approve this device' }).click(),
    ]);

    expect(approval.status()).toBe(200);

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

    await resumed.close();
  } finally {
    await desktop.close();
  }
});
