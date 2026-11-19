import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type Request, type Response } from 'express';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createServer } from 'vite';
import type * as VaultRuntime from '@visomi-stack/web-frontend-db';
import type * as VaultStorage from '@visomi-stack/web-frontend-db/storage';
import type * as Contracts from '@visomi-stack/shared-db';
import type { Observability } from '@visomi-stack/web-backend-shared';

import { authConfig, createApp, createAuthentication } from '../../../src/app';

import { resource, policy, syntheticPersistenceSecret } from './persistence';

type VaultApi = typeof VaultRuntime & typeof VaultStorage;

export type FixtureHost = typeof globalThis & {
  modules: { api: VaultApi; contracts: typeof Contracts };
  client: {
    binding: Contracts.WrappingContext;
    vault: InstanceType<VaultApi['BrowserVault']>;
    custody: InstanceType<VaultApi['DeviceCustody']>;
    challenge: Contracts.DeviceProof;
    storage: VaultStorage.IndexedDbReplicaStorage;
    replica?: InstanceType<VaultApi['SyncReplica']>;
    enterPin?: (correct: boolean) => void;
    csrf: string;
    path: string;
  };
};

/** Test-only same-origin module host with the real authenticated API and private PostgreSQL adapter. */
export async function browserServer(observability?: Observability) {
  const api = express();
  // Parallel fixture servers must not replace each other's optimized modules.
  const cacheDir = await mkdtemp(join(tmpdir(), 'visomi-api-browser-vite-'));
  const removeCache = () => rm(cacheDir, { recursive: true, force: true });
  const server = await createServer({
    root: fileURLToPath(new URL('../../../../../../', import.meta.url)),
    cacheDir,
    configFile: false,
    appType: 'custom',
    resolve: { tsconfigPaths: true },
    // The injected module is invisible to the HTML dependency scan.
    optimizeDeps: { noDiscovery: true, include: ['dexie', 'hash-wasm', 'zod'] },
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      {
        name: 'synthetic-protocol-client',
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url === '/') {
              response.setHeader('content-type', 'text/html');
              response.end(
                '<!doctype html><html lang="en"><title>Synthetic protocol client</title><body>Protocol fixture</body></html>',
              );

              return;
            }

            api(request as Request, response as Response, next);
          });
        },
      },
    ],
  }).catch(async (error: unknown) => {
    await removeCache();

    throw error;
  });

  const closeServer = () => server.close().finally(removeCache);
  let origin: string;
  let browser: Browser;

  try {
    await server.listen();

    origin = `http://localhost:${(server.httpServer?.address() as AddressInfo).port}`;
    const auth = createAuthentication({
      database: resource.db,
      pool: resource.pool,
      config: authConfig({ origin, rpId: 'localhost', secret: syntheticPersistenceSecret }),
    });

    api.use('/api', createApp({ auth, persistence: policy, observability }));

    const launched = await chromium.launch({ headless: true });

    browser = launched;
  } catch (error) {
    await closeServer();

    throw error;
  }

  return {
    origin,
    async client(cookie: string, { prf = true, mobileViewport = false } = {}) {
      const context = await browser.newContext({ viewport: mobileViewport ? { width: 390, height: 844 } : undefined });

      await context.addCookies([
        { name: 'visomi.sid', value: cookie, url: origin, httpOnly: true, sameSite: 'Strict' },
      ]);

      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);

      await cdp.send('WebAuthn.enable');

      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
          hasPrf: prf,
        },
      });

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

        await page.addScriptTag({
          type: 'module',
          content:
            "import * as runtime from '/libs/web/frontend/db/src/index.ts'; import * as storage from '/libs/web/frontend/db/src/storage.ts'; const api = { ...runtime, ...storage }; import * as contracts from '/libs/shared/db/src/index.ts'; globalThis.modules = { api, contracts };",
        });

        await page.waitForFunction(() => Boolean((globalThis as FixtureHost).modules), undefined, { polling: 100 });
      } catch (error) {
        const statuses = [...failedModuleResponses].join(', ') || 'none';

        const failure = new Error(
          `Vault API fixture startup failed (script HTTP statuses: ${statuses}; page error: ${scriptError})`,
        );

        throw Object.assign(failure, { cause: error });
      }

      return { context, page };
    },
    async close() {
      try {
        await browser.close();
      } finally {
        await closeServer();
      }
    },
  };
}

export type ProtocolBrowser = { context: BrowserContext; page: Page };
