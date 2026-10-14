import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { requireFreeGatewayPort, stopGateway, waitForGateway } from './gateway-process';
import { gatewayStorageEnvironment } from './gateway-environment';

const SERVER_PID_PATH = resolve(__dirname, '../../.api-e2e-server.pid');

const SERVER_ENTRYPOINT = resolve(__dirname, '../../../../../dist/apps/web/server/main.js');

const teardownState = globalThis as typeof globalThis & {
  __TEARDOWN_MESSAGE__?: string;
  __API_E2E_GATEWAY__?: ChildProcess;
};

process.env['NX_DAEMON'] = 'false';

module.exports = async function () {
  const host = process.env.HOST ?? 'localhost';

  const port = process.env.GATEWAY_PORT ? Number(process.env.GATEWAY_PORT) : 8080;
  const storageEnvironment = gatewayStorageEnvironment(process.env);

  await requireFreeGatewayPort(host, port);

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

  const serverProcess = spawn(process.execPath, ['--experimental-vm-modules', SERVER_ENTRYPOINT], {
    detached: true,
    env: {
      ...process.env,
      BASE_URL: `http://${host}:${port}`,
      COOKIE_SECURE: 'false',
      DATABASE_AUTO_MIGRATE: 'true',
      ...storageEnvironment,
      ENABLE_TEST_API: 'true',
      ENABLE_LOCAL_ACTIVATION: 'false',
      GOOGLE_AUTH_CLIENT_ID: '',
      AUTH_TOTP_ENROLLMENT_ENABLED: 'true',
      AUTH_TOTP_ENCRYPTION_KEY: 'themis-api-e2e-dedicated-totp-key-2026',
      HOST: host,
      GATEWAY_PORT: String(port),
      MAIL_TRANSPORT: 'memory',
      NG_ALLOWED_HOSTS: host,
      NODE_ENV: 'test',
      PORT: String(port),
      SESSION_SECRET: 'themis-api-e2e-secret',
    },
    stdio: process.env['PZS005_SERVER_LOG'] ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (serverProcess.pid == null) {
    throw new Error('Failed to start composition server process for API e2e tests.');
  }

  const log = process.env['PZS005_SERVER_LOG']
    ? createWriteStream(process.env['PZS005_SERVER_LOG'], { flags: 'w' })
    : undefined;

  if (log && serverProcess.stdout && serverProcess.stderr) {
    log.write(`PZS005_RUN_ID=${process.env['PZS005_RUN_ID'] ?? 'unspecified'}\n`);

    serverProcess.stdout.pipe(log, { end: false });
    serverProcess.stderr.pipe(log, { end: false });
    serverProcess.once('close', () => log.end());
  }

  await writeFile(SERVER_PID_PATH, String(serverProcess.pid));
  teardownState.__API_E2E_GATEWAY__ = serverProcess;
  serverProcess.unref();

  try {
    await waitForGateway(serverProcess, `http://${host}:${port}/healthz`);
  } catch (error) {
    await stopGateway(serverProcess);
    await rm(SERVER_PID_PATH, { force: true });
    delete teardownState.__API_E2E_GATEWAY__;
    throw error;
  }

  teardownState.__TEARDOWN_MESSAGE__ = '\nTearing down composition server...\n';
};
