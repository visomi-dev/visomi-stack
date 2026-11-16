import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import express, { type Request, type Response } from 'express';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createServer } from 'vite';
import type * as VaultApi from '@visomi-stack/web-shared-vault';
import type * as Contracts from '@visomi-stack/shared-persistence';
import type { Observability } from '@visomi-stack/web-backend-shared';

import { authConfig, createApp, createAuthentication } from '../../../src/app';

import { resource, policy, syntheticPersistenceSecret } from './persistence';

export type FixtureHost = typeof globalThis & {
  modules: { api: typeof VaultApi; contracts: typeof Contracts };
  client: {
    binding: Contracts.WrappingContext;
    vault: VaultApi.BrowserVault;
    custody: VaultApi.DeviceCustody;
    challenge: Contracts.DeviceProof;
    storage: VaultApi.IndexedDbReplicaStorage;
    replica?: VaultApi.SyncReplica;
    csrf: string;
    path: string;
  };
};

/** Test-only same-origin module host with the real authenticated API and private PostgreSQL adapter. */
export async function browserServer(observability?: Observability) {
  const api = express();
  const server = await createServer({
    root: fileURLToPath(new URL('../../../../../../', import.meta.url)),
    configFile: false,
    appType: 'custom',
    resolve: { tsconfigPaths: true },
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
  });

  await server.listen();

  const origin = `http://localhost:${(server.httpServer?.address() as AddressInfo).port}`;
  const auth = createAuthentication({
    database: resource.db,
    pool: resource.pool,
    config: authConfig({ origin, rpId: 'localhost', secret: syntheticPersistenceSecret }),
  });

  api.use('/api', createApp({ auth, persistence: policy, observability }));
  const browser = await chromium.launch({ headless: true });

  return {
    origin,
    async client(cookie: string) {
      const context = await browser.newContext();

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
          hasPrf: true,
        },
      });

      await page.goto(origin);

      await page.addScriptTag({
        type: 'module',
        content:
          "import * as api from '/libs/web/shared/vault/src/index.ts'; import * as contracts from '/libs/shared/persistence/src/index.ts'; globalThis.modules = { api, contracts };",
      });

      await page.waitForFunction(() => Boolean((globalThis as FixtureHost).modules));

      return { context, page };
    },
    async close() {
      await browser.close();

      await server.close();
    },
  };
}

export type ProtocolBrowser = { context: BrowserContext; page: Page };
