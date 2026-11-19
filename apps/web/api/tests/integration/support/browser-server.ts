import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { build } from 'vite';
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

let bundle: Promise<string> | undefined;

async function compileBrowserClient(): Promise<string> {
  const result = await build({
    root: fileURLToPath(new URL('../../../../../../', import.meta.url)),
    configFile: false,
    envFile: false,
    resolve: { tsconfigPaths: true },
    logLevel: 'silent',
    build: {
      lib: {
        entry: fileURLToPath(
          new URL('../../../../../../libs/web/frontend/db/tests/support/protocol-client.ts', import.meta.url),
        ),
        formats: ['es'],
      },
      write: false,
    },
  });
  const [generated] = Array.isArray(result) ? result : [result];

  if (!generated || !('output' in generated)) {
    throw new Error('synthetic_browser_bundle_missing');
  }

  const [chunk] = generated.output;

  if (generated.output.length !== 1 || chunk?.type !== 'chunk') {
    throw new Error('synthetic_browser_bundle_invalid');
  }

  return chunk.code;
}

/** Test-only same-origin host with the real authenticated API and private PostgreSQL adapter. */
export async function browserServer(observability?: Observability) {
  const code = await (bundle ??= compileBrowserClient());
  const api = express();
  const server = createServer(api);
  const closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()));

  api.get('/', (_request, response) =>
    response
      .type('html')
      .send(
        '<!doctype html><html lang="en"><title>Synthetic protocol client</title>' +
          '<script type="module" src="/browser-client.mjs"></script><body>Protocol fixture</body></html>',
      ),
  );
  api.get('/browser-client.mjs', (_request, response) => response.type('text/javascript').send(code));

  let origin: string;
  let browser: Browser;

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    origin = `http://localhost:${(server.address() as AddressInfo).port}`;
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
