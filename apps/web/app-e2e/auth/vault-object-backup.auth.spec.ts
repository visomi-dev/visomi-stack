import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { BrowserContext, Page, Request } from '@playwright/test';
import { readMailCode } from '@visomi-stack/dev-testing';
import { backupS3Client } from '@visomi-stack/dev-testing/s3';
import { serializeDataEnvelope, syncWriteSchema, type DataEnvelope } from '@visomi-stack/shared-db';
import { Pool } from 'pg';
import { io } from 'socket.io-client';

import { expect, test, signup, passwordStart } from './support/fixtures';

// The paired recipient uses Chromium's native virtual WebAuthn authenticator.
// eslint-disable-next-line playwright/no-skipped-test
test.skip(({ browserName }) => browserName !== 'chromium', 'Requires Chromium CDP');

function persistenceRequestBody(request: Request): string {
  return request.url().includes('/api/example/vault/') ? (request.postData() ?? '') : '';
}

async function replicaNote(page: Page, objectId: string): Promise<{ pending?: DataEnvelope; stored?: DataEnvelope }> {
  return page.evaluate(async (id) => {
    const databases = await indexedDB.databases();
    const name = databases.find((database) => database.name?.startsWith('visomi-sync:'))?.name;

    if (!name) {
      return {};
    }

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T>(store: string) =>
      new Promise<T[]>((resolve, reject) => {
        const request = database.transaction(store).objectStore(store).getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

    try {
      const [outbox, records] = await Promise.all([
        read<{ value: { envelope: DataEnvelope } }>('outbox'),
        read<DataEnvelope>('units'),
      ]);

      return {
        pending: outbox.map((row) => row.value.envelope).find((envelope) => envelope.context.objectId === id),
        stored: records.find((envelope) => envelope.context.objectId === id),
      };
    } finally {
      database.close();
    }
  }, objectId);
}

async function objectFor(scopeId: string, objectId: string, envelope: DataEnvelope) {
  const directory = process.env['VISOMI_E2E_TELEMETRY_DIR']!;
  const [database, storage] = await Promise.all([
    readFile(join(directory, 'database.json'), 'utf8'),
    readFile(join(directory, 's3.json'), 'utf8'),
  ]);
  const pool = new Pool({ connectionString: JSON.parse(database).url as string });
  const wire = serializeDataEnvelope(envelope);
  const digest = createHash('sha256').update(wire).digest('base64url');
  const endpoint = JSON.parse(storage).endpoint as string;
  const s3 = backupS3Client(endpoint);

  try {
    const results = await pool.query<{ envelope: { id: string }; bytes: number }>(
      `
      select envelope, bytes from vault_opaque_units where scope_id = $1 and id = $2
      union all select envelope, bytes from vault_opaque_events where scope_id = $1
    `,
      [scopeId, objectId],
    );

    expect(results.rows).toHaveLength(2);
    const reference = {
      format: 'vault-object',
      version: 1,
      id: results.rows[0].envelope.id,
      digest,
      generation: envelope.context.key.generation,
    };

    expect(results.rows).toEqual(
      Array.from({ length: 2 }, () => ({ envelope: reference, bytes: Buffer.byteLength(wire) })),
    );
    const key = `vault-backups/${scopeId}/${reference.id}`;
    const result = await s3('GET', key);
    const stored = await result.text();

    expect(stored).toBe(wire);

    return { key, wire, endpoint };
  } finally {
    await pool.end();
  }
}

async function rejectLoginOnlyWatch(context: BrowserContext, origin: string) {
  const cookies = await context.cookies(origin);
  const socket = io(`${origin}/vault`, {
    autoConnect: false,
    reconnection: false,
    transports: ['websocket'],
    extraHeaders: { origin, cookie: cookies.map(({ name, value }) => `${name}=${value}`).join('; ') },
  });

  try {
    const result = await new Promise<string>((resolve) => {
      socket.once('connect_error', (error) => resolve(error.message));
      socket.once('connect', () => resolve('connected'));
      socket.connect();
    });

    expect(result).toBe('subscription_unavailable');
  } finally {
    socket.disconnect();
  }
}

async function publishNote(page: Page, note: string) {
  const panel = page.locator('app-database-example');

  await panel.getByLabel('Private text', { exact: true }).fill(note);

  await panel.getByRole('button', { name: 'Save encrypted change' }).click();

  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith('/sync/push')),
    panel.getByRole('button', { name: 'Upload encrypted note' }).click(),
  ]);

  expect(response.ok()).toBe(true);

  await expect(panel.getByRole('status').filter({ hasText: 'The encrypted note is backed up' })).toBeVisible();
}

test('backs up the Vault Example note to private object storage and restores it only after recipient pairing', async ({
  page,
  context,
  browser,
}, info) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true });
  });

  const note = 'SYNTHETIC_VAULT_BACKUP_SAME_NOTE';
  const nextNote = `${note}_SECOND`;
  const offlineNote = `${note}_WHILE_LOCKED`;
  const pin = '048261';
  let exposedSecret = false;
  let uploads = 0;
  const observe = (request: Request) => {
    const payload = persistenceRequestBody(request);

    exposedSecret ||= payload.includes(note) || /"048261"|"(?:pin|prf|methodId|secret)"\s*:/.test(payload);
    uploads += Number(request.url().endsWith('/sync/push'));
  };

  page.on('request', observe);
  const email = await signup(page);

  await page.goto('/app/en/example/vault');

  const panel = page.locator('app-database-example');

  await expect(panel.getByRole('heading', { name: 'Back up and restore a test note' })).toBeVisible();

  await panel.getByRole('button', { name: 'Create a backup test workspace' }).click();

  await panel.getByLabel('Local unlock PIN', { exact: true }).fill(pin);

  await panel.getByLabel('Confirm your new PIN', { exact: true }).fill(pin);

  await panel.getByRole('button', { name: 'Set up an empty private resource with PIN' }).click();

  await panel.getByLabel('Private text', { exact: true }).fill(note);

  await panel.getByRole('button', { name: 'Save encrypted change' }).click();

  await expect(panel.locator('pre')).toHaveText(note);

  const workspace = new URL(page.url());
  const objectId = workspace.searchParams.get('objectId')!;
  const source = await replicaNote(page, objectId);

  expect(source.stored).toBeUndefined();
  expect(uploads).toBe(0);

  const [request] = await Promise.all([
    page.waitForRequest((candidate) => candidate.url().endsWith('/sync/push')),
    panel.getByRole('button', { name: 'Upload encrypted note' }).click(),
  ]);
  const uploaded = syncWriteSchema.parse(request.postDataJSON());

  expect(uploaded.envelope).toEqual(source.pending);

  await expect(panel.getByRole('status').filter({ hasText: 'The encrypted note is backed up' })).toBeVisible();

  const committed = await replicaNote(page, objectId);

  expect(committed.stored).toEqual(uploaded.envelope);
  expect(committed.pending).toBeUndefined();
  const object = await objectFor(workspace.searchParams.get('scopeId')!, objectId, uploaded.envelope);

  await panel.getByRole('link', { name: 'Vault devices' }).click();

  const approving = page.locator('[data-vault-approver]');

  await expect(approving).toHaveText(/^[A-Za-z0-9_-]{43}$/);

  const approver = await approving.innerText();
  const pairingUrl = page.url();
  const recipientContext = await browser.newContext({
    baseURL: info.project.use.baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': '198.19.1.1' },
  });
  const outsiderContext = await browser.newContext({
    baseURL: info.project.use.baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': '198.19.1.2' },
  });
  const s3 = backupS3Client(object.endpoint);

  try {
    const recipient = await recipientContext.newPage();
    const outsider = await outsiderContext.newPage();
    const hints: unknown[] = [];
    let vaultConnections = 0;

    recipient.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload === 'string' && payload.startsWith('40/vault,')) {
          vaultConnections++;
        }

        if (typeof payload === 'string' && payload.startsWith('42/vault,')) {
          hints.push(JSON.parse(payload.slice('42/vault,'.length)));
        }
      });
    });

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

    await signup(outsider);

    const denied = outsider.waitForResponse((response) => response.url().endsWith('/private-resources/devices'));

    await outsider.goto(workspace.href);

    const deniedResponse = await denied;

    expect(deniedResponse.status()).toBe(403);

    await expect(outsider.getByText('This account doesn’t have access to the backup workspace.')).toBeVisible();

    await expect(outsider.getByRole('button', { name: 'Download and restore note' })).toHaveCount(0);

    await passwordStart(recipient, email);

    const code = await readMailCode(email);

    await recipient.getByLabel('Verification code', { exact: true }).fill(code);

    await expect(recipient.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

    await recipient.goto(workspace.href);

    const restore = recipient.getByRole('button', { name: 'Download and restore note' });

    await expect(recipient.getByText(/To restore the note on this browser/)).toBeVisible();

    await expect(restore).toHaveCount(0);

    await expect(recipient.getByText(note, { exact: true })).toHaveCount(0);

    await expect(replicaNote(recipient, objectId)).resolves.toEqual({});

    const pullPath = new URL(request.url()).pathname.replace(/\/push$/, '/pull');
    const loginOnlyStatus = await recipient.evaluate(async (path) => {
      const session = await fetch('/api/auth/session');
      const raw: unknown = await session.json();
      const { csrfToken } = raw as { csrfToken: string };
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ protocol: 1, head: { cursor: 0, checkpoint: null } }),
      });

      return response.status;
    }, pullPath);

    expect(loginOnlyStatus).toBe(403);

    await rejectLoginOnlyWatch(recipientContext, workspace.origin);

    await recipient.getByRole('link', { name: 'Vault devices' }).click();

    await expect(recipient).toHaveURL(pairingUrl);

    await recipient.getByRole('button', { name: 'Request pairing with a passkey' }).click();

    const fingerprint = recipient.locator('[data-vault-recipient]');

    await expect(fingerprint).toHaveText(/^[A-Za-z0-9_-]{43}$/);

    const recipientId = await fingerprint.innerText();
    const pairingRequest = await recipient.getByLabel('Pairing request', { exact: true }).inputValue();
    const trust = recipient.getByLabel('Approving device fingerprint', { exact: true });
    const finish = recipient.getByRole('button', { name: 'Finish pairing', exact: true });

    await trust.fill(approver);

    const unapproved = recipient.waitForResponse((response) => response.url().endsWith('/delivery'));

    await finish.click();

    const deniedDelivery = await unapproved;

    expect(deniedDelivery.status()).toBe(404);

    await expect(recipient.getByRole('link', { name: 'Open test private resource' })).toHaveCount(0);

    await expect(replicaNote(recipient, objectId)).resolves.toEqual({});

    await page.getByLabel('Pairing request', { exact: true }).fill(pairingRequest);

    await page.getByLabel('New device fingerprint', { exact: true }).fill(recipientId);

    await page.getByRole('button', { name: 'Approve this device' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Device approved.' })).toBeVisible();

    await finish.click();

    await recipient.getByRole('link', { name: 'Open test private resource' }).click();

    await expect(recipient).toHaveURL(workspace.href);

    await expect(restore).toBeEnabled();

    await expect(recipient.getByText(note, { exact: true })).toHaveCount(0);

    await expect(replicaNote(recipient, objectId)).resolves.toEqual({});

    const replace = async (body: string) => {
      const result = await s3('PUT', object.key, body);

      await result.body?.cancel();
    };

    await replace(object.wire.slice(1));

    const [failed] = await Promise.all([
      recipient.waitForResponse((response) => response.url().endsWith('/sync/pull')),
      restore.click(),
    ]);

    expect(failed.status()).toBe(503);

    await expect(
      recipient.getByText('We couldn’t verify the encrypted backup. Your local data is unchanged. Try again later.'),
    ).toBeVisible();

    await expect(replicaNote(recipient, objectId)).resolves.toEqual({});

    await replace(object.wire);

    const retry = recipient.getByRole('button', { name: 'Retry Vault sync' });

    await expect(retry).toBeVisible();

    const [download] = await Promise.all([
      recipient.waitForResponse((response) => response.url().endsWith('/sync/pull')),
      retry.click(),
    ]);

    expect(download.ok()).toBe(true);

    await expect(recipient.locator('app-database-example pre')).toHaveText(note);

    const restored = await replicaNote(recipient, objectId);

    expect(restored.stored).toEqual(uploaded.envelope);
    expect(restored.pending).toBeUndefined();

    await expect.poll(() => vaultConnections).toBeGreaterThan(0);

    await page.goto(workspace.href);

    await panel.getByLabel('Local unlock PIN', { exact: true }).fill(pin);

    await panel.getByRole('button', { name: 'Unlock with PIN', exact: true }).click();

    await expect(panel.locator('pre')).toHaveText(note);

    await recipient.setViewportSize({ width: 390, height: 844 });

    const indicator = recipient.locator('app-vault-sync-indicator');
    const indicatorStatus = indicator.getByRole('status');
    const peerPanel = recipient.locator('app-database-example');
    const draft = peerPanel.getByLabel('Private text', { exact: true });

    await expect(indicatorStatus).toHaveText('Vault synced');

    await draft.fill('SYNTHETIC_UNSAVED_LOCAL_DRAFT');

    await publishNote(page, nextNote);

    await expect.poll(() => hints).toEqual([['vault:changed', 2]]);

    await expect(peerPanel.locator('pre')).toHaveText(note);

    await expect(draft).toHaveValue('SYNTHETIC_UNSAVED_LOCAL_DRAFT');

    await expect(replicaNote(recipient, objectId)).resolves.toEqual(restored);

    const originalBox = await indicator.boundingBox();
    let releasePull!: () => void;
    const paused = new Promise<void>((resolve) => {
      releasePull = resolve;
    });

    await recipient.route('**/sync/pull', async (route) => {
      await paused;

      await route.continue();
    });

    try {
      await draft.fill('');

      await expect(indicatorStatus).toHaveText('Syncing Vault…');

      await expect(indicator.boundingBox()).resolves.toEqual(originalBox);
    } finally {
      releasePull();
    }

    await expect(peerPanel.locator('pre')).toHaveText(nextNote);

    await expect(indicatorStatus).toHaveText('Vault synced');

    await expect(indicator.boundingBox()).resolves.toEqual(originalBox);

    await expect(recipient).toHaveURL(workspace.href);

    await recipient.unroute('**/sync/pull');

    const prior = await replicaNote(recipient, objectId);

    expect(prior.stored?.context.revision).toBe(2);

    await recipient.getByRole('button', { name: 'Lock private resources' }).click();

    await expect(peerPanel.getByRole('button', { name: 'Unlock with a passkey' })).toBeVisible();

    await publishNote(page, offlineNote);

    await expect(peerPanel.locator('pre')).toHaveCount(0);

    await expect(replicaNote(recipient, objectId)).resolves.toEqual(prior);

    expect(hints).toEqual([['vault:changed', 2]]);

    await peerPanel.getByRole('button', { name: 'Unlock with a passkey' }).click();

    await expect(peerPanel.locator('pre')).toHaveText(offlineNote);

    await expect.poll(() => vaultConnections).toBeGreaterThan(1);

    await expect(indicatorStatus).toHaveText('Vault synced');

    await recipient.route('**/sync/pull', (route) => route.abort());

    await recipient.goto(workspace.href.replace('/app/en/', '/app/es/'));

    const restoredPanel = recipient.locator('app-database-example');

    await expect(restoredPanel.getByRole('heading', { name: 'Respalda y restaura una nota de prueba' })).toBeVisible();

    await expect(recipient.getByText(note, { exact: true })).toHaveCount(0);

    await restoredPanel.getByRole('button', { name: 'Desbloquear con una clave de acceso' }).click();

    await expect(restoredPanel.locator('pre')).toHaveText(offlineNote);

    expect(uploads).toBe(3);
    expect(exposedSecret).toBe(false);
  } finally {
    await Promise.all([recipientContext.close(), outsiderContext.close()]);
  }
});
