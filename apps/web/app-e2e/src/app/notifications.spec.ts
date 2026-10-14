import { createECDH, randomBytes, randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

import { authenticateViaDeterministicTestSession, createCredentials } from '../support/auth';

function invalidation(socket: Socket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('notifications:changed', receive);
      reject(new Error('Notification invalidation timed out.'));
    }, 10_000);
    const receive = (input: unknown) => {
      clearTimeout(timeout);
      socket.off('notifications:changed', receive);
      resolve(input);
    };

    socket.once('notifications:changed', receive);
  });
}

function connected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Notification socket connection timed out.')), 10_000);
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      socket.off('connect', ready);
      socket.off('connect_error', finish);
      if (error) reject(error);
      else resolve();
    };
    const ready = () => finish();

    socket.once('connect', ready);
    socket.once('connect_error', finish);
  });
}

test('persists generic completion notifications, read state and account isolation through the gateway', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
  await authenticateViaDeterministicTestSession(page, request, createCredentials().email, '');
  await page.goto('/app/en/notifications');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notifications');
  await expect(page.getByText('You are all caught up.', { exact: false })).toBeVisible();
  const preference = page.getByRole('checkbox', { name: 'Allow device alerts for account activity' });

  await expect(preference).not.toBeChecked();
  await preference.check();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByText('Delivery preferences saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(preference).toBeChecked();
  const created = await page.request.post('/api/projects', { data: { name: 'Notification fixture' } });

  expect(created.status()).toBe(201);
  const project = (await created.json()).data.id as string;
  const accepted = await page.request.post(`/api/projects/${project}/seed`);

  expect(accepted.status()).toBe(202);
  await expect
    .poll(async () => {
      const response = await page.request.get('/api/notifications');

      expect(response.headers()['cache-control']).toBe('no-store');

      return (await response.json()).data.notifications.length as number;
    })
    .toBe(1);
  // The session-bound invalidation triggers an authorized HTTP reload, without manual refresh.
  await expect(page.getByRole('heading', { name: 'Account activity completed' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(page.getByText('Read', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Read', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/es/notifications');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notificaciones');
  await expect(page.getByRole('button', { name: 'Marcar como leída' })).toBeDisabled();
  await expect(
    page.getByRole('checkbox', { name: 'Permitir alertas del dispositivo sobre la actividad de la cuenta' }),
  ).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('notifications-mobile-es.png'), fullPage: true });
  const signedOut = await test.step('Sign out through the browser CSRF boundary', () =>
    page.evaluate(async () => {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
        signal: AbortSignal.timeout(10_000),
      });

      return response.ok;
    }));

  expect(signedOut).toBe(true);
  await test.step('Authenticate a different account', () =>
    authenticateViaDeterministicTestSession(page, request, createCredentials().email, ''));
  await page.goto('/app/en/notifications');
  await expect(page.getByText('You are all caught up.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Account activity completed' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Allow device alerts for account activity' })).not.toBeChecked();
});

test('catches up a content-free inbox watch after reconnect and rejects a signed-out session', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await authenticateViaDeterministicTestSession(page, request, createCredentials().email, '');
  const cookies = (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join('; ');
  const publicKey = createECDH('prime256v1');

  publicKey.generateKeys();
  const registration = {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: { p256dh: publicKey.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
  const unavailable = await page.evaluate(
    async (input) =>
      (
        await fetch('/api/notifications/subscriptions', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(10_000),
        })
      ).status,
    registration,
  );

  expect(unavailable).toBe(503);
  const removed = await page.evaluate(
    async () =>
      (
        await fetch('/api/notifications/subscriptions', {
          method: 'DELETE',
          credentials: 'include',
          signal: AbortSignal.timeout(10_000),
        })
      ).status,
  );

  expect(removed).toBe(204);
  const socket = io(baseURL!, {
    autoConnect: false,
    path: '/socket.io',
    transports: ['websocket'],
    extraHeaders: { cookie: cookies },
    forceNew: true,
  });

  try {
    let ready = connected(socket);

    socket.connect();
    await ready;
    let changed = invalidation(socket);

    socket.emit('notifications:watch');
    expect(await changed).toEqual({});
    socket.disconnect();
    // Preferences commit while this watcher is disconnected. Reconnect must catch up.
    const saved = await page.evaluate(
      async () =>
        (
          await fetch('/api/notifications/preferences', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ servicePush: true }),
            signal: AbortSignal.timeout(10_000),
          })
        ).status,
    );

    expect(saved).toBe(204);
    ready = connected(socket);
    socket.connect();
    await ready;
    changed = invalidation(socket);
    socket.emit('notifications:watch');
    expect(await changed).toEqual({});
    const feed = await page.request.get('/api/notifications');

    expect((await feed.json()).data).toMatchObject({ servicePush: true, pushAvailable: false });
    socket.emit('notifications:unwatch');
    const signedOut = await page.evaluate(
      async () =>
        (
          await fetch('/api/auth/sign-out', {
            method: 'POST',
            credentials: 'include',
            signal: AbortSignal.timeout(10_000),
          })
        ).status,
    );

    expect(signedOut).toBe(204);
    const received: unknown[] = [];

    socket.on('notifications:changed', (input: unknown) => received.push(input));
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Revoked notification socket did not disconnect.')), 10_000);

      socket.once('disconnect', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.emit('notifications:watch');
    });
    expect(received).toEqual([]);
    expect((await page.request.get('/api/notifications')).status()).toBe(401);
  } finally {
    socket.disconnect();
  }
});
