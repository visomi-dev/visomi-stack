import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from '@playwright/test';
import { build } from 'esbuild';

import type * as FrontendModule from '../libs/frontend/shared/src/index';

const directory = await mkdtemp(join(tmpdir(), 'visomi-sync-smoke-'));
const bundlePath = join(directory, 'sync.js');
await build({
  entryPoints: ['libs/frontend/shared/src/index.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'FrontendModule',
  outfile: bundlePath,
});
const sent: string[] = [];
const server = createServer(async (request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>encrypted sync smoke</title>');
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const input = JSON.parse(Buffer.concat(chunks).toString()) as { envelope: { envelopeId: string } };
  const id = input.envelope.envelopeId;

  if (id === 'conflict' || id === 'blocked') {
    response.writeHead(id === 'conflict' ? 409 : 403);
    response.end();
    return;
  }

  sent.push(id);
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ data: { cursor: sent.length, duplicate: false } }));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Sync smoke server did not start.');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch();

try {
  const context = await browser.newContext();
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all(
    pages.map(async (page) => {
      await page.goto(origin);
      await page.addScriptTag({ path: bundlePath });
    }),
  );
  await Promise.all(
    pages.map((page, index) =>
      page.evaluate(
        async ({ origin, index }) => {
          const { createPersistentBrowserSyncHttp } = (
            globalThis as typeof globalThis & { FrontendModule: typeof FrontendModule }
          ).FrontendModule;
          const adapter = createPersistentBrowserSyncHttp(
            'owner',
            { baseUrl: origin, workspaceId: 'workspace-a', deviceId: 'device-a', enrollmentVersion: 1 },
            indexedDB,
            navigator.locks,
          );
          for (const id of index === 0 ? ['deliverable', 'conflict'] : ['blocked', 'another']) {
            await adapter.enqueue({
              format: 'themis.encrypted-envelope',
              version: 1,
              kind: 'sync-object',
              envelopeId: id,
              workspaceId: 'workspace-a',
              recordType: 'projection',
              revision: 1,
              createdAt: '2026-10-03T12:00:00.000Z',
              associatedData: {},
              metadata: {},
              nonce: 'bm9uY2U',
              ciphertext: 'Y2lwaGVydGV4dA',
              authTag: 'dGFn',
            });
          }
        },
        { origin, index },
      ),
    ),
  );
  await pages[0].reload();
  await pages[0].addScriptTag({ path: bundlePath });
  const observed = await pages[0].evaluate(async (origin) => {
    const { createPersistentBrowserSyncHttp, IndexedDbSyncStateStore } = (
      globalThis as typeof globalThis & { FrontendModule: typeof FrontendModule }
    ).FrontendModule;
    const adapter = createPersistentBrowserSyncHttp(
      'owner',
      { baseUrl: origin, workspaceId: 'workspace-a', deviceId: 'device-a', enrollmentVersion: 1 },
      indexedDB,
      navigator.locks,
    );
    await adapter.initialize();
    const reopenedQueue = adapter.snapshot().queue.length;
    const first = await adapter.flush();
    const second = await adapter.flush();
    const otherOwnerEmpty =
      (await new IndexedDbSyncStateStore(indexedDB, navigator.locks, 'other-owner', 'workspace-a').load()) ===
      undefined;
    return {
      reopenedQueue,
      first,
      second,
      statuses: adapter
        .snapshot()
        .queue.map((entry) => entry.status)
        .sort(),
      otherOwnerEmpty,
    };
  }, origin);
  assert.equal(observed.reopenedQueue, 4);
  assert.deepEqual(observed.first, { sent: 2, pending: 2 });
  assert.deepEqual(observed.second, { sent: 0, pending: 2 });
  assert.deepEqual(observed.statuses, ['blocked', 'conflict']);
  assert.equal(observed.otherOwnerEmpty, true);
  assert.deepEqual(sent.sort(), ['another', 'deliverable']);
  await mkdir('tmp/browser-sync-smoke', { recursive: true });
  await writeFile('tmp/browser-sync-smoke/result.json', `${JSON.stringify({ ...observed, sent }, null, 2)}\n`);
  console.log(JSON.stringify(observed, null, 2));
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
}
