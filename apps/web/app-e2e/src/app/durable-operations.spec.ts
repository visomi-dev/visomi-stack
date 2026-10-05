import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

import { authenticateViaDeterministicTestSession, createCredentials } from '../support/auth';

type Completion = { operationId: string; status: string; result?: { jobId: string } };

function nextEvent(socket: Socket, operationId: string): Promise<Completion> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('operation:changed', receive);
      reject(new Error('Operation event timed out.'));
    }, 15000);
    const receive = (event: Completion) => {
      if (event.operationId === operationId && ['completed', 'failed'].includes(event.status)) {
        clearTimeout(timeout);
        socket.off('operation:changed', receive);
        resolve(event);
      }
    };

    socket.on('operation:changed', receive);
  });
}

test('persists accepted work, delivers session-bound completion and replays it after reconnect', async ({
  page,
  request,
  baseURL,
}) => {
  const credentials = createCredentials();

  await authenticateViaDeterministicTestSession(page, request, credentials.email, '');
  await page.goto('/app/en/dashboard');
  const created = await page.request.post('/api/projects', { data: { name: 'Durable operations fixture' } });

  expect(created.status()).toBe(201);
  const projectId = (await created.json()).data.id as string;
  const requestKey = randomUUID();
  const accepted = await page.request.post(`/api/projects/${projectId}/seed`, {
    headers: { 'Idempotency-Key': requestKey },
  });

  expect(accepted.status()).toBe(202);
  expect(accepted.headers()['cache-control']).toBe('no-store');
  const ticket = (await accepted.json()).data.operation as { operationId: string; expiresAt: string };
  const repeated = await page.request.post(`/api/projects/${projectId}/seed`, {
    headers: { 'Idempotency-Key': requestKey },
  });

  expect((await repeated.json()).data.operation).toEqual(ticket);
  const cookies = (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join('; ');
  const socket = io(baseURL!, {
    path: '/socket.io',
    transports: ['websocket'],
    extraHeaders: { cookie: cookies },
    forceNew: true,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const completed = nextEvent(socket, ticket.operationId);

    socket.emit('operation:watch', { operationId: ticket.operationId });
    expect(await completed).toEqual({
      operationId: ticket.operationId,
      status: 'completed',
      result: { jobId: ticket.operationId },
    });
    socket.disconnect();
    const connected = new Promise<void>((resolve) => socket.once('connect', resolve));

    socket.connect();
    await connected;
    const replayed = nextEvent(socket, ticket.operationId);

    socket.emit('operation:watch', { operationId: ticket.operationId });
    expect(await replayed).toEqual({
      operationId: ticket.operationId,
      status: 'completed',
      result: { jobId: ticket.operationId },
    });
    const status = await page.request.get(`/api/operations/${ticket.operationId}`);

    expect(status.headers()['cache-control']).toBe('no-store');
    expect((await status.json()).data.status).toBe('completed');
    const jobs = await page.request.get(`/api/projects/${projectId}/jobs`);

    expect((await jobs.json()).data.jobs).toHaveLength(1);
    // This request fixture holds a different session for the same user.
    const other = await request.post('/api/test/auth/session', { data: { email: credentials.email } });

    expect(other.ok()).toBe(true);
    expect((await request.get(`/api/operations/${ticket.operationId}`)).status()).toBe(404);
    const disconnected = new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));

    const signedOut = await page.evaluate(
      async () => (await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' })).ok,
    );

    expect(signedOut).toBe(true);
    socket.emit('operation:watch', { operationId: ticket.operationId });
    await disconnected;
  } finally {
    socket.disconnect();
  }
});

test('keeps a single translated shell heading through account and security navigation', async ({
  page,
  request,
}, testInfo) => {
  await authenticateViaDeterministicTestSession(page, request, createCredentials().email, '');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/en/account');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your account');
  await expect(page.locator('[data-slot="page-title"] h1')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('shell-account-mobile.png'), fullPage: true });
  await page.goto('/app/en/security/sessions');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Active sessions');
  await page.goto('/app/es/security');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Seguridad');
  await expect(page.locator('[data-slot="page-title"] h1')).toHaveCount(1);
});
