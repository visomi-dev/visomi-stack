import { execFile } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCompose, runTestCompose } from './compose';
import type { TestCompose } from './compose';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const owner: TestCompose = {
  provider: 'docker',
  directory: '/synthetic/visomi-auth-test-owned',
  project: 'visomi-auth-test-owned',
  telemetryDirectory: '/synthetic/telemetry',
  app: 'web-api',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VISOMI_TEST_COMPOSE', undefined);
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    (args.at(-1) as (error: null, output: object) => void)(null, { stdout: '', stderr: '' });
  }) as never);
});

afterEach(() => vi.unstubAllEnvs());

describe('test Compose command ownership', () => {
  it.each(['docker', 'podman-compose'] as const)('honors the explicit %s provider', async (provider) => {
    vi.stubEnv('VISOMI_TEST_COMPOSE', provider);
    const resource = await createTestCompose(owner.directory, owner.telemetryDirectory, 'web-gateway');

    expect(resource).toEqual({
      ...owner,
      provider,
      app: 'web-gateway',
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('detects Docker Compose without consulting a daemon or starting services', async () => {
    const resource = await createTestCompose(owner.directory, owner.telemetryDirectory, 'web-api');

    expect(resource.provider).toBe('docker');
    expect(execFile).toHaveBeenCalledExactlyOnceWith('docker', ['compose', 'version'], expect.any(Function));
  });

  it('uses podman-compose when Docker Compose is unavailable', async () => {
    vi.mocked(execFile).mockImplementationOnce(((...args: unknown[]) => {
      (args.at(-1) as (error: Error) => void)(new Error('synthetic_docker_unavailable'));
    }) as never);
    const resource = await createTestCompose(owner.directory, owner.telemetryDirectory, 'web-api');

    expect(resource.provider).toBe('podman-compose');
    expect(execFile).toHaveBeenLastCalledWith('podman-compose', ['version'], expect.any(Function));
  });

  it('rejects an unsupported provider instead of interpreting a shell command', async () => {
    vi.stubEnv('VISOMI_TEST_COMPOSE', 'synthetic; unsafe');

    await expect(createTestCompose(owner.directory, owner.telemetryDirectory, 'web-api')).rejects.toThrow(
      'test_compose_provider_invalid',
    );

    expect(execFile).not.toHaveBeenCalled();
  });

  it.each(['web-api', 'web-gateway'] as const)('isolates %s from ambient development settings', async (app) => {
    vi.stubEnv('APP_DATABASE_URL', 'postgresql://synthetic-development/never-use');
    vi.stubEnv('POSTGRES_DB', 'synthetic-development');
    vi.stubEnv('HOST_BINDING', '0.0.0.0:');

    await runTestCompose({ ...owner, app }, ['up', '-d', '--build', 'app']);

    const [command, args, options] = vi.mocked(execFile).mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string> },
    ];

    expect(command).toBe('docker');
    expect(args).toEqual(
      expect.arrayContaining([
        'compose',
        '--env-file',
        owner.directory + '/compose.env',
        '-p',
        owner.project,
        'up',
        '-d',
        '--build',
        'app',
      ]),
    );
    expect(options.env).toMatchObject({
      APP_NAME: app,
      VISOMI_TEST_APP_ROOT: app === 'web-api' ? 'apps/web/api' : 'apps/web/gateway',
      APP_PORT: app === 'web-api' ? '3307' : '3317',
      POSTGRES_DB: 'visomi_auth_test',
      POSTGRES_PORT: '',
      HOST_BINDING: '127.0.0.1:',
      APP_DATABASE_URL: 'postgresql://visomi_test:synthetic-test-password@postgres:5432/visomi_auth_test',
      VISOMI_TEST_TELEMETRY_DIR: owner.telemetryDirectory,
    });
  });

  it('invokes the Podman provider directly with the same owned project', async () => {
    await runTestCompose({ ...owner, provider: 'podman-compose' }, ['down', '--volumes']);

    const [command, args] = vi.mocked(execFile).mock.calls[0];

    expect(command).toBe('podman-compose');
    expect(args).not.toContain('compose');
    expect(args).toEqual(expect.arrayContaining(['-p', owner.project, 'down', '--volumes']));
  });

  it.each([
    { directory: '/synthetic/developer-data' },
    { project: 'visomi-local' },
    { provider: 'synthetic-command' },
    { app: 'synthetic-app' },
    { app: 'api' },
    { app: 'gateway' },
  ])('refuses an unowned or unsupported descriptor: %j', (change) => {
    expect(() => runTestCompose({ ...owner, ...change } as TestCompose, ['down', '--volumes'])).toThrow(
      'isolated_compose_owner_invalid',
    );
    expect(execFile).not.toHaveBeenCalled();
  });
});
