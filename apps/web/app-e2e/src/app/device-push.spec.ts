import { createECDH, randomBytes, randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { authenticateViaDeterministicTestSession, createCredentials } from '../support/auth';

test('registers explicit device alerts through the real service worker and gateway without provider traffic', async ({
  page,
  request,
}) => {
  test.skip(process.env['WEB_PUSH_ENABLED'] !== 'true', 'Requires explicit isolated Web Push/VAPID configuration.');
  test.setTimeout(60_000);
  const browserKey = createECDH('prime256v1');

  browserKey.generateKeys();
  const fixture = {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: { p256dh: browserKey.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };

  // The external provider boundary is synthetic; Angular SwPush, ngsw and every HTTP request are real.
  // This fixture intentionally creates no notification after registration, so no vendor send can occur.
  await page.addInitScript((input) => {
    const key = 'visomi-device-push-e2e';
    const subscription = () => ({
      endpoint: input.endpoint,
      options: { userVisibleOnly: true },
      expirationTime: null,
      toJSON: () => ({ ...input, expirationTime: null }),
      unsubscribe: async () => {
        localStorage.removeItem(key);

        return true;
      },
    });

    Object.defineProperty(PushManager.prototype, 'getSubscription', {
      configurable: true,
      value: async () => (localStorage.getItem(key) ? subscription() : null),
    });
    Object.defineProperty(PushManager.prototype, 'subscribe', {
      configurable: true,
      value: async () => {
        localStorage.setItem(key, 'registered');

        return subscription();
      },
    });
  }, fixture);
  await authenticateViaDeterministicTestSession(page, request, createCredentials().email, '');
  await page.goto('/app/en/notifications');
  await expect(page.getByRole('button', { name: 'Enable device alerts', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('visomi-device-push-e2e'))).toBeNull();
  await page.getByRole('button', { name: 'Enable device alerts', exact: true }).click();
  await expect(
    page.getByText('Device alerts are registered for your current session and account.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove device alerts', exact: true })).toBeVisible();
  await page.goto('/app/es/notifications');
  await expect(page.getByRole('heading', { name: 'Este dispositivo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Eliminar alertas del dispositivo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Activar alertas del dispositivo', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('visomi-device-push-e2e'))).toBeNull();
});
