import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll } from 'vitest';
import type { DataContext, WrappingContext } from '@visomi-stack/shared-db';
import type * as VaultContracts from '@visomi-stack/shared-db';

import type * as VaultRuntime from '../../src/index';
import type * as VaultStorage from '../../src/storage';

type VaultApi = typeof VaultRuntime & typeof VaultStorage;

let server: ViteDevServer;
let cacheDir: string | undefined;

export let browser: Browser;
let origin: string;

export const vector = JSON.parse(
  readFileSync(new URL('../../../../../shared/db/fixtures/crypto-v1.json', import.meta.url), 'utf8'),
) as { data: { context: DataContext }; wrapped: { context: WrappingContext } };

export const pinVector = JSON.parse(
  readFileSync(new URL('../../../../../shared/db/fixtures/pin-v1.json', import.meta.url), 'utf8'),
) as { pin: string; methodId: string; secret: string };

export type FixtureWindow = typeof globalThis & {
  fixtureModules: { api: VaultApi; contracts: typeof VaultContracts };
  fixtureVault?: InstanceType<VaultApi['BrowserVault']>;
  fixtureState?: string;
};

export async function prepare(page: Page) {
  const failedModuleResponses = new Set<number>();
  let scriptError = false;

  page.on('response', (response) => {
    if (response.request().resourceType() === 'script' && response.status() >= 400) {
      failedModuleResponses.add(response.status());
    }
  });
  page.on('pageerror', () => {
    scriptError = true;
  });

  try {
    await page.goto(origin);

    const ready = await page.evaluate(() => Boolean((globalThis as FixtureWindow).fixtureModules));

    if (!ready) {
      throw new Error('Fixture module did not load with the document');
    }
  } catch (error) {
    const statuses = [...failedModuleResponses].join(', ') || 'none';

    throw new Error(
      `Vault SDK fixture startup failed (script HTTP statuses: ${statuses}; page error: ${scriptError})`,
      {
        cause: error,
      },
    );
  }
}

beforeAll(async () => {
  // Parallel fixture servers must not replace each other's optimized modules.
  const directory = await mkdtemp(join(tmpdir(), 'visomi-sdk-browser-vite-'));

  cacheDir = directory;

  const created = await createServer({
    root: fileURLToPath(new URL('../../../../../../', import.meta.url)),
    cacheDir: directory,
    configFile: false,
    appType: 'custom',
    resolve: { tsconfigPaths: true },
    // The test-only HTML is served by middleware, outside the dependency scan.
    optimizeDeps: { noDiscovery: true, include: ['dexie', 'hash-wasm', 'zod'] },
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'silent',
    plugins: [
      {
        name: 'synthetic-vault-fixture',
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url !== '/') {
              next();

              return;
            }

            response.setHeader('content-type', 'text/html');
            response.end(`<!doctype html>
              <html lang="en">
                <head>
                  <title>Synthetic vault fixture</title>
                  <script type="module" src="/libs/web/frontend/db/tests/support/browser-entry.ts"></script>
                </head>
                <body>Vault storage test</body>
              </html>`);
          });
        },
      },
    ],
  });

  server = created;

  await server.listen();

  origin = `http://localhost:${(server.httpServer?.address() as AddressInfo).port}`;
  const launched = await chromium.launch({ headless: true });

  browser = launched;
}, 60_000);

afterAll(async () => {
  try {
    await browser?.close();
  } finally {
    await server?.close();

    if (cacheDir) {
      await rm(cacheDir, { recursive: true, force: true });
    }
  }
}, 60_000);
