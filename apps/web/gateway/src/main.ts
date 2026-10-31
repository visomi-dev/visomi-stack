#!/usr/bin/env tsx
// @nx-target-name: serve
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createDatabase,
  createSmtp,
  smtpConfig,
  type MailTransport,
  type DatabaseResource,
} from '@visomi-stack/backend-shared';
import { browserAssets, createBrowserTelemetry, initializeObservability } from '@visomi-stack/web-backend-shared';

import packageJson from '../package.json' with { type: 'json' };

import { loadApi } from './api-module';
import type { EmbeddedAuthentication } from './api-module';
import { createGatewayApp } from './app';
import { loadSite } from './site-module';

const observability = initializeObservability({
  service: 'web-gateway',
  version: packageJson.version,
  environment: process.env.NODE_ENV,
});
let database: DatabaseResource | undefined;
let mail: MailTransport | undefined;
let auth: EmbeddedAuthentication | undefined;
const server = createServer();
let stopping = false;

async function stop(exitCode: number): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  const deadline = setTimeout(() => {
    observability.event('runtime.failed', 'shutdown_timeout');
    process.exit(1);
  }, 5000);
  const drain = setTimeout(() => server.closeAllConnections(), 3000);

  await new Promise<void>((resolve) => server.close(() => resolve()));

  clearTimeout(drain);
  let databaseClosed = true;

  try {
    mail?.close();
  } catch {
    databaseClosed = false;
  }

  try {
    await database?.close();
  } catch {
    databaseClosed = false;
  }
  observability.event(
    !databaseClosed || exitCode ? 'runtime.failed' : 'runtime.stopped',
    !databaseClosed ? 'shutdown_failed' : exitCode ? 'startup_failed' : 'none',
  );
  const flushed = await observability.shutdown(1000);

  clearTimeout(deadline);
  process.exitCode = flushed && databaseClosed ? exitCode : 1;
}

function onSignal(): void {
  void stop(0);
}

process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);
server.once('error', () => void stop(1));

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);

async function bootstrap() {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('gateway_configuration_invalid');
  }

  const entry = process.env.API_APP_PATH
    ? pathToFileURL(resolve(process.env.API_APP_PATH))
    : new URL('../api/app.js', import.meta.url);
  const siteEntry = process.env.SITE_APP_PATH
    ? pathToFileURL(resolve(process.env.SITE_APP_PATH))
    : new URL('../site/server/entry.mjs', import.meta.url);
  const [api, site] = await Promise.all([loadApi(entry), loadSite(siteEntry)]);

  if (stopping) {
    return;
  }

  if (process.env.DATABASE_URL) {
    const config = api.authConfig({
      origin: process.env.AUTH_ORIGIN!,
      rpId: process.env.AUTH_RP_ID!,
      secret: process.env.SESSION_SECRET!,
      googleClientId: process.env.GOOGLE_AUTH_CLIENT_ID || undefined,
      totpKey: process.env.AUTH_TOTP_ENCRYPTION_KEY || undefined,
    });

    const smtp = smtpConfig(process.env);

    mail = smtp ? createSmtp(smtp) : undefined;
    database = createDatabase(process.env.DATABASE_URL, () => observability.event('runtime.failed'));
    auth = api.createAuthentication({ database: database.db, pool: database.pool, config, mail });

    await database.pool.query('SELECT 1');
  }

  if (stopping) {
    return;
  }

  let browserTelemetry;

  if (process.env.VISOMI_BROWSER_TELEMETRY === 'true' && site) {
    const assets = await browserAssets(site.clientDirectory);

    browserTelemetry = createBrowserTelemetry({
      observability,
      application: 'web-site',
      assets,
      origin: process.env.BROWSER_TELEMETRY_ORIGIN ?? 'https://stack.visomi.dev',
    });
  }

  const application = createGatewayApp({
    api,
    site,
    auth,
    observability,
    ...(browserTelemetry ? { browserTelemetry } : {}),
    ...(process.env.AUTH_TRUST_PROXY
      ? { trustProxy: process.env.AUTH_TRUST_PROXY.split(',').map((value) => value.trim()) }
      : {}),
  });

  server.on('request', application);
  server.listen(port, host, async () => {
    observability.event('runtime.started');

    if (process.env.NX_READY_SIGNAL_SOCKET) {
      try {
        const { emitReadySignal } = await import('@nx/js/ready-signal');

        emitReadySignal(server);
      } catch {
        // Nx readiness is optional for standalone execution.
      }
    }
  });
}

void bootstrap().catch(() => {
  if (!stopping) {
    void stop(1);
  }
});
