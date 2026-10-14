import { webcrypto, randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { createCredentials, registerAndAuthenticate } from '../support/auth';

import { decodeRecoveryBytes, sealSyncProjection } from 'shared-crypto';

// Isolate memory-only authentication budgets between scenarios, never between proofs.
test.beforeEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});
test.afterEach(async ({ request }) => {
  expect((await request.delete('/api/test/auth/rate-limits')).status()).toBe(204);
});

test('restores encrypted projections through authorized gateway sync and drops plaintext on lock and device revocation', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await registerAndAuthenticate(page, request, createCredentials().email);
  await page.goto('/app/en/security/vault');
  await page.getByLabel('Six-digit vault PIN', { exact: true }).fill('829374');
  await page.getByRole('button', { name: 'Create a new vault', exact: true }).click();
  const dialog = page.getByRole('dialog');

  await dialog.getByRole('button', { name: 'Continue with a passkey', exact: true }).click();
  await expect(page.getByText('Vault PIN saved on this browser.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal recovery key', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue with a passkey', exact: true }).click();
  const recovery = await page.locator('app-vault-settings code').innerText();
  const session = (await (await page.request.get('/api/auth/session')).json()).data;
  const created = await page.request.post('/api/projects', { data: { name: 'Encrypted projection fixture' } });

  expect(created.status()).toBe(201);
  const workspaceId = (await created.json()).data.id as string;
  const root = `/api/sync/${workspaceId}`;
  const ownerResponse = await page.request.post(`${root}/devices`, {
    data: { publicKey: randomUUID(), label: 'Fixture authority' },
  });

  expect(ownerResponse.ok(), await ownerResponse.text()).toBe(true);
  const ownerDeviceId = (await ownerResponse.json()).data.deviceId as string;

  expect(
    (
      await page.request.post(`${root}/devices/${ownerDeviceId}/approval`, {
        data: { approverDeviceId: ownerDeviceId },
      })
    ).ok(),
  ).toBe(true);
  const deviceResponse = await page.request.post(`${root}/devices`, {
    data: { publicKey: randomUUID(), label: 'Fixture consumer' },
  });
  const deviceId = (await deviceResponse.json()).data.deviceId as string;
  const bytes = decodeRecoveryBytes(recovery);
  let key: CryptoKey;

  try {
    key = await webcrypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    bytes.fill(0);
  }
  const envelope = await sealSyncProjection(
    webcrypto as unknown as Crypto,
    key,
    { ownerUserId: session.user.id, accountId: session.user.accountId, workspaceId },
    {
      entityId: randomUUID(),
      envelopeId: randomUUID(),
      actorId: session.user.id,
      entityType: 'work',
      operation: 'upsert',
      revision: 1,
      value: { title: 'Never persist this plaintext fixture' },
    },
    '2026-10-04T12:00:00.000Z',
  );
  const enrolled = await page.request.post(`${root}/devices/${deviceId}/enroll`, {
    data: {
      approverDeviceId: ownerDeviceId,
      envelope: { ...envelope, recordType: 'workspace-key-distribution', metadata: { recipientDeviceId: deviceId } },
    },
  });

  expect(enrolled.ok()).toBe(true);
  const enrollmentVersion = (await enrolled.json()).data.enrollmentVersion as number;

  expect(
    (await page.request.post(`${root}/envelopes`, { data: { envelope, deviceId, enrollmentVersion } })).status(),
  ).toBe(201);
  const panel = page.locator('app-sync-status');
  const connect = async () => {
    await panel.getByLabel('Enrolled workspace ID', { exact: true }).fill(workspaceId);
    await panel.getByLabel('Enrolled device ID', { exact: true }).fill(deviceId);
    await panel.getByLabel('Device enrollment version', { exact: true }).fill(String(enrollmentVersion));
    await panel.getByRole('button', { name: 'Connect enrolled workspace', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText('Encrypted workspace connected.');
    await expect(panel.getByText('Local projections: 1', { exact: true })).toBeVisible();
  };

  await connect();
  const persisted = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('visomi-encrypted-projections', 1);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    try {
      return await new Promise<string>((resolve, reject) => {
        const request = db.transaction('envelopes').objectStore('envelopes').getAll();

        request.onsuccess = () => resolve(JSON.stringify(request.result));
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });

  expect(persisted).not.toContain('Never persist this plaintext fixture');
  expect(persisted).not.toContain(recovery);
  expect(persisted).toContain(envelope.ciphertext);
  expect(
    (
      await new AxeBuilder({ page })
        .include('app-sync-status')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await expect(
    panel.getByText('Unlock your vault before connecting encrypted workspace data.', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText('Local projections: 1', { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByLabel('Six-digit vault PIN', { exact: true }).fill('829374');
  await page.getByRole('button', { name: 'Unlock with browser PIN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock vault', exact: true })).toBeVisible();
  await connect();
  expect((await page.request.post(`${root}/devices/${deviceId}/revoke`)).ok()).toBe(true);
  await panel.getByRole('button', { name: 'Synchronize now', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Synchronization could not finish.');
  await expect(panel.getByText('Local projections: 1', { exact: true })).toHaveCount(0);
  await page.goto('/app/es/security/vault');
  await expect(
    page.getByRole('heading', { name: 'Sincronización cifrada del espacio de trabajo', exact: true }),
  ).toBeVisible();
});
