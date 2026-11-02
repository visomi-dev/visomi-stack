import { createServer } from 'node:http';

import { clientDirectory, createApp } from './server';

import { browserAssets, createBrowserTelemetry, initializeObservability } from '@visomi-stack/web-backend-shared';

const telemetry = initializeObservability({
  service: 'web-app',
  version: process.env['APP_VERSION'] ?? 'unknown',
  environment: process.env['NODE_ENV'],
});
const server = createServer();
let browserTelemetry: ReturnType<typeof createBrowserTelemetry> | undefined;
let stopping = false;

async function stop(exitCode: number): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 5000);
  const drain = setTimeout(() => server.closeAllConnections(), 3000);

  await new Promise<void>((resolve) => server.close(() => resolve()));

  clearTimeout(drain);
  browserTelemetry?.close();
  const flushed = await telemetry.shutdown(1000);

  clearTimeout(deadline);
  process.exitCode = flushed ? exitCode : 1;
}

process.once('SIGTERM', () => void stop(0));
process.once('SIGINT', () => void stop(0));
server.once('error', () => void stop(1));

async function start(): Promise<void> {
  const port = Number(process.env['PORT'] ?? 4201);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('app_configuration_invalid');
  }

  if (process.env['VISOMI_BROWSER_TELEMETRY'] === 'true') {
    const assets = await browserAssets(clientDirectory, '/app');

    if (stopping) {
      return;
    }

    browserTelemetry = createBrowserTelemetry({
      observability: telemetry,
      assets: { 'web-app': assets },
      origin: process.env['BROWSER_TELEMETRY_ORIGIN'] ?? `http://127.0.0.1:${port}`,
      performance: process.env['VISOMI_BROWSER_PERFORMANCE'] === 'true',
    });
  }

  if (stopping) {
    return;
  }

  server.on('request', createApp({ observability: telemetry, ...(browserTelemetry ? { browserTelemetry } : {}) }));
  server.listen(port, process.env['HOST'] ?? '127.0.0.1');
}

void start().catch(() => void stop(1));
