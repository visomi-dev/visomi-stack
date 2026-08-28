import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { waitForPortOpen } from '@nx/node/utils';

const SERVER_PID_PATH = resolve(__dirname, '../../.api-e2e-server.pid');

const SERVER_ENTRYPOINT = resolve(__dirname, '../../../../../dist/apps/web/server/main.js');

const teardownState = globalThis as typeof globalThis & { __TEARDOWN_MESSAGE__?: string };

module.exports = async function () {
  const host = process.env.HOST ?? 'localhost';

  const port = process.env.GATEWAY_PORT ? Number(process.env.GATEWAY_PORT) : 8080;

  const build = spawnSync('pnpm', ['exec', 'nx', 'run', 'server:build', '--skip-nx-cache'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (build.status !== 0 || !existsSync(SERVER_ENTRYPOINT)) {
    throw new Error(
      `API E2E requires the current server bundle at ${SERVER_ENTRYPOINT}. ` +
        `Build command: pnpm exec nx run server:build --skip-nx-cache. ` +
        `Exit: ${build.status ?? 'unknown'}\n${build.stdout ?? ''}\n${build.stderr ?? ''}`,
    );
  }

  if (process.env['PZS005_SERVER_LOG']) {
    await mkdir(dirname(resolve(process.env['PZS005_SERVER_LOG'])), { recursive: true });
  }

  const serverProcess = spawn(process.execPath, [SERVER_ENTRYPOINT], {
    detached: true,
    env: {
      ...process.env,
      COOKIE_SECURE: 'false',
      DATABASE_AUTO_MIGRATE: 'true',
      // Keep the fast in-memory composition by default, but allow the
      // durable API lifecycle matrix to opt into the configured PostgreSQL
      // and object-store boundary explicitly.
      DATABASE_DRIVER:
        process.env['OPAQUE_SYNC_STORAGE'] === 'durable' && process.env['DATABASE_DRIVER'] === 'pg' ? 'pg' : 'memory',
      ENABLE_TEST_API: 'true',
      HOST: host,
      GATEWAY_PORT: String(port),
      MAIL_TRANSPORT: 'memory',
      NG_ALLOWED_HOSTS: host,
      NODE_ENV: 'test',
      OPAQUE_SYNC_STORAGE: process.env['OPAQUE_SYNC_STORAGE'] ?? 'memory',
      PORT: String(port),
      SESSION_SECRET: 'themis-api-e2e-secret',
    },
    stdio: process.env['PZS005_SERVER_LOG'] ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (serverProcess.pid == null) {
    throw new Error('Failed to start composition server process for API e2e tests.');
  }

  if (process.env['PZS005_SERVER_LOG'] && serverProcess.stdout && serverProcess.stderr) {
    const log = createWriteStream(process.env['PZS005_SERVER_LOG'], { flags: 'w' });

    log.write(`PZS005_RUN_ID=${process.env['PZS005_RUN_ID'] ?? 'unspecified'}\n`);

    serverProcess.stdout.pipe(log, { end: false });
    serverProcess.stderr.pipe(log, { end: false });
  }

  await writeFile(SERVER_PID_PATH, String(serverProcess.pid));
  serverProcess.unref();

  try {
    await waitForPortOpen(port, { host });

    let healthy = false;
    let lastHealthError = 'health endpoint did not return an OK response';

    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`http://${host}:${port}/healthz`, { signal: AbortSignal.timeout(1000) });

        if (response.ok) {
          healthy = true;
          break;
        }
        lastHealthError = `HTTP ${response.status}`;
      } catch (error: unknown) {
        lastHealthError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (!healthy) {
      throw new Error(
        `API E2E gateway failed health check at http://${host}:${port}/healthz after 40 attempts (${lastHealthError}). ` +
          `The server bundle was verified at ${SERVER_ENTRYPOINT}; inspect ${process.env['PZS005_SERVER_LOG'] ?? 'the captured server output'} and confirm the configured API dependencies are available.`,
      );
    }
  } catch (error) {
    serverProcess.kill('SIGTERM');
    throw error;
  }

  teardownState.__TEARDOWN_MESSAGE__ = '\nTearing down composition server...\n';
};
