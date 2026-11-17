import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
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

export let browser: Browser;
let origin: string;

export const vector = JSON.parse(
  readFileSync(new URL('../../../../../shared/db/fixtures/crypto-v1.json', import.meta.url), 'utf8'),
) as { data: { context: DataContext }; wrapped: { context: WrappingContext } };

export type FixtureWindow = typeof globalThis & {
  fixtureModules: { api: VaultApi; contracts: typeof VaultContracts };
  fixtureVault?: InstanceType<VaultApi['BrowserVault']>;
  fixtureState?: string;
};

export async function prepare(page: Page) {
  await page.goto(origin);

  await page.addScriptTag({
    type: 'module',
    content:
      "import * as runtime from '/libs/web/frontend/db/src/index.ts'; import * as storage from '/libs/web/frontend/db/src/storage.ts'; const api = { ...runtime, ...storage }; import * as contracts from '/libs/shared/db/src/index.ts'; globalThis.fixtureModules = { api, contracts };",
  });

  await page.waitForFunction(() => Boolean((globalThis as FixtureWindow).fixtureModules));
}

beforeAll(async () => {
  const created = await createServer({
    root: fileURLToPath(new URL('../../../../../../', import.meta.url)),
    configFile: false,
    appType: 'custom',
    resolve: { tsconfigPaths: true },
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
            response.end(
              '<!doctype html><html lang="en"><title>Synthetic vault fixture</title><body>Vault storage test</body></html>',
            );
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
  await browser?.close();

  await server?.close();
}, 60_000);
