import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import { workspaceRoot } from '@nx/devkit';

const execute = promisify(execFile);

export type TestCompose = {
  provider: 'docker' | 'podman-compose';
  project: string;
  directory: string;
  telemetryDirectory: string;
  app: 'web-api' | 'web-gateway';
};

export async function createTestCompose(
  directory: string,
  telemetryDirectory: string,
  app: TestCompose['app'],
): Promise<TestCompose> {
  const configured = process.env.VISOMI_TEST_COMPOSE;
  let provider: TestCompose['provider'];

  if (configured === 'docker' || configured === 'podman-compose') {
    provider = configured;
  } else if (configured) {
    throw new Error('test_compose_provider_invalid');
  } else {
    try {
      await execute('docker', ['compose', 'version']);
      provider = 'docker';
    } catch {
      await execute('podman-compose', ['version']);
      provider = 'podman-compose';
    }
  }

  return { provider, project: basename(directory).toLowerCase(), directory, telemetryDirectory, app };
}

export function runTestCompose(
  owner: TestCompose,
  args: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  if (
    !basename(owner.directory).startsWith('visomi-auth-test-') ||
    owner.project !== basename(owner.directory).toLowerCase() ||
    !['docker', 'podman-compose'].includes(owner.provider) ||
    !['web-api', 'web-gateway'].includes(owner.app)
  ) {
    throw new Error('isolated_compose_owner_invalid');
  }

  return execute(
    owner.provider,
    [
      ...(owner.provider === 'docker' ? ['compose'] : []),
      '--env-file',
      join(owner.directory, 'compose.env'),
      '-f',
      join(workspaceRoot, 'compose.yaml'),
      '-f',
      join(workspaceRoot, 'compose.test.yaml'),
      '-p',
      owner.project,
      ...args,
    ],
    {
      cwd: workspaceRoot,
      signal,
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        // Override ambient development settings; Compose must only reach this owned test database.
        COMPOSE_PROJECT_NAME: owner.project,
        APP_NAME: owner.app,
        VISOMI_TEST_APP_ROOT: owner.app === 'web-api' ? 'apps/web/api' : 'apps/web/gateway',
        APP_PORT: owner.app === 'web-api' ? '3307' : '3317',
        APP_DATABASE_URL: 'postgresql://visomi_test:synthetic-test-password@postgres:5432/visomi_auth_test',
        POSTGRES_DB: 'visomi_auth_test',
        POSTGRES_USER: 'visomi_test',
        POSTGRES_PASSWORD: 'synthetic-test-password',
        POSTGRES_PORT: '',
        HOST_BINDING: '127.0.0.1:',
        AUTH_ORIGIN: owner.app === 'web-api' ? 'http://127.0.0.1:3307' : 'http://127.0.0.1:3317',
        AUTH_RP_ID: '127.0.0.1',
        SESSION_SECRET: 'synthetic-e2e-only-session-secret-32-bytes',
        VISOMI_TEST_TELEMETRY_DIR: owner.telemetryDirectory,
        HEALTHCHECK_INTERVAL: '1s',
        HEALTHCHECK_START_PERIOD: '1s',
      },
    },
  );
}
