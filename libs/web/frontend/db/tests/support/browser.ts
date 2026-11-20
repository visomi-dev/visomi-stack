import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from '@playwright/test';
import { build } from 'vite';
import { afterAll, beforeAll } from 'vitest';
import type { DataContext, WrappingContext } from '@visomi-stack/shared-db';
import type * as VaultContracts from '@visomi-stack/shared-db';

import type * as VaultRuntime from '../../src/index';
import type * as VaultStorage from '../../src/storage';

type VaultApi = typeof VaultRuntime & typeof VaultStorage;

let server: Server | undefined;

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

    await page.waitForFunction(() => Boolean((globalThis as FixtureWindow).fixtureModules), undefined, {
      polling: 100,
      timeout: 5000,
    });
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
  // Compile the fixture before listening so Chromium always receives the complete module.
  const result = await build({
    root: fileURLToPath(new URL('../../../../../../', import.meta.url)),
    configFile: false,
    envFile: false,
    resolve: { tsconfigPaths: true },
    logLevel: 'silent',
    build: {
      lib: { entry: fileURLToPath(new URL('browser-entry.ts', import.meta.url)), formats: ['es'] },
      write: false,
    },
  });
  const [bundle] = Array.isArray(result) ? result : [result];

  if (!bundle || !('output' in bundle) || bundle.output.length !== 1 || bundle.output[0].type !== 'chunk') {
    throw new Error('synthetic_vault_bundle_invalid');
  }

  const code = bundle.output[0].code;
  const created = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><html lang="en"><title>Synthetic vault fixture</title>' +
          '<script type="module" src="/fixture.mjs"></script><body>Vault storage test</body></html>',
      );
    } else if (request.url === '/fixture.mjs') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(code);
    } else {
      response.writeHead(404).end();
    }
  });

  server = created;

  await new Promise<void>((resolve, reject) => {
    created.once('error', reject);
    created.listen(0, '127.0.0.1', () => {
      created.off('error', reject);
      resolve();
    });
  });

  origin = `http://localhost:${(created.address() as AddressInfo).port}`;
  const launched = await chromium.launch({ headless: true });

  browser = launched;
}, 60_000);

afterAll(async () => {
  try {
    await browser?.close();
  } finally {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }
}, 60_000);
