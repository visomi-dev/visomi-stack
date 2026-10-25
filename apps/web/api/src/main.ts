#!/usr/bin/env tsx
// @nx-target-name: serve
import { createServer } from 'node:http';

import { initializeObservability } from '@visomi-stack/web-backend-shared';

import packageJson from '../package.json' with { type: 'json' };

import { createApp } from './app';

const observability = initializeObservability({
  service: 'web-api',
  version: packageJson.version,
  environment: process.env.NODE_ENV,
});
const server = createServer(createApp({ observability }));
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
  observability.event(exitCode ? 'runtime.failed' : 'runtime.stopped', exitCode ? 'startup_failed' : 'none');
  const flushed = await observability.shutdown(1000);

  clearTimeout(deadline);
  process.exitCode = flushed ? exitCode : 1;
}

function onSignal(): void {
  void stop(0);
}

process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);
server.once('error', () => void stop(1));

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  void stop(1);
} else {
  server.listen(port, host, async () => {
    observability.event('runtime.started');

    if (process.env.NX_READY_SIGNAL_SOCKET) {
      try {
        const load = new Function('specifier', 'return import(specifier)') as (
          specifier: string,
        ) => Promise<{ emitReadySignal(server: unknown): boolean }>;
        const ready = await load('@nx/js/ready-signal');

        ready.emitReadySignal(server);
      } catch {
        // Nx readiness is optional for standalone execution.
      }
    }
  });
}
