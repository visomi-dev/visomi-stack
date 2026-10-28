import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCompose, runTestCompose } from './compose';
import type { TestCompose } from './compose';
import { testPostgres, stopTestPostgres } from './postgres';

const boundary = vi.hoisted(() => ({
  clients: [] as { query: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }[],
  failures: 0,
}));

vi.mock('./compose', () => ({ createTestCompose: vi.fn(), runTestCompose: vi.fn() }));
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn() }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();

  return { ...actual, readFile: vi.fn(actual.readFile) };
});
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: (options: unknown) => options }));
vi.mock('drizzle-orm/node-postgres/migrator', () => ({ migrate: vi.fn() }));
vi.mock('pg', () => ({
  Pool: vi.fn(function () {
    const client = {
      query: vi.fn().mockImplementation(async () => {
        if (boundary.failures-- > 0) {
          throw new Error('SYNTHETIC_PRIVATE_DATABASE_ERROR');
        }

        return { rows: [] };
      }),
      end: vi.fn().mockResolvedValue(undefined),
    };

    boundary.clients.push(client);

    return client;
  }),
}));

let directory: string;

function descriptor(cluster: string): TestCompose {
  return {
    provider: 'podman-compose',
    project: basename(cluster).toLowerCase(),
    directory: cluster,
    telemetryDirectory: directory,
    app: 'web-api',
  };
}

beforeEach(async () => {
  vi.resetAllMocks();
  boundary.clients.length = 0;
  boundary.failures = 0;
  vi.mocked(migrate).mockResolvedValue(undefined);
  vi.mocked(runTestCompose).mockResolvedValue({ stdout: '127.0.0.1:54321\n', stderr: '' });
  vi.mocked(createTestCompose).mockImplementation(async (cluster, telemetryDirectory, app) => ({
    ...descriptor(cluster),
    telemetryDirectory,
    app,
  }));
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

  vi.mocked(readFile).mockImplementation(actual.readFile);
  const temporary = await mkdtemp(join(tmpdir(), 'visomi-postgres-unit-'));

  directory = temporary;
});

afterEach(async () => {
  vi.unstubAllEnvs();

  await rm(directory, { recursive: true, force: true });
});

async function owned() {
  const cluster = await mkdtemp(join(directory, 'visomi-auth-test-'));

  await writeFile(join(cluster, 'test-owner'), 'visomi-stack-isolated-postgres');

  return cluster;
}

describe('Compose PostgreSQL resource', () => {
  it('migrates an owned container database without consulting developer DATABASE_URL and closes its pool', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic-developer-database/never-use');
    const resource = await testPostgres();

    expect(resource.url).toBe('postgresql://visomi_test:synthetic-test-password@127.0.0.1:54321/visomi_auth_test');
    expect(runTestCompose).toHaveBeenCalledWith(resource.compose, ['up', '-d', 'postgres'], undefined);
    expect(boundary.clients[0].query).toHaveBeenCalledExactlyOnceWith('SELECT 1');
    expect(boundary.clients[0].end).toHaveBeenCalledOnce();
    expect(vi.mocked(migrate).mock.calls[0][1].migrationsFolder).toMatch(
      /libs\/backend\/shared\/src\/lib\/database\/migrations$/,
    );
    const first = resource.stop();

    expect(resource.stop()).toBe(first);

    await first;

    await expect(stat(resource.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('records ownership before startup and selects the gateway build without reading a developer env file', async () => {
    const manifest = join(directory, 'postgres.json');
    const resource = await testPostgres(manifest, 'web-gateway');

    const text = await readFile(manifest, 'utf8');
    const envFile = await readFile(join(resource.directory, 'compose.env'), 'utf8');

    expect(JSON.parse(text)).toEqual({
      directory: resource.directory,
      compose: resource.compose,
    });
    expect(envFile).toBe('');
    expect(resource.compose.app).toBe('web-gateway');

    await resource.stop();
  });

  it.each(['0.0.0.0:54321', '127.0.0.1:0', '127.0.0.1:65536', 'synthetic-invalid-port'])(
    'cleans up an invalid host port: %s',
    async (stdout) => {
      vi.mocked(runTestCompose).mockResolvedValue({ stdout, stderr: '' });
      const manifest = join(directory, 'postgres.json');

      await expect(testPostgres(manifest)).rejects.toThrow('isolated_postgres_setup_failed');

      const text = await readFile(manifest, 'utf8');
      const owner = JSON.parse(text);

      expect(runTestCompose).toHaveBeenLastCalledWith(owner.compose, ['down', '--volumes', '--remove-orphans']);

      await expect(stat(owner.directory)).rejects.toMatchObject({ code: 'ENOENT' });

      expect(boundary.clients).toHaveLength(0);
    },
  );

  it('removes the owned directory when provider discovery fails before a container can start', async () => {
    vi.mocked(createTestCompose).mockRejectedValue(new Error('SYNTHETIC_PRIVATE_PROVIDER_ERROR'));

    await expect(testPostgres(join(directory, 'postgres.json'))).rejects.toThrow('isolated_postgres_setup_failed');

    const entries = await readdir(directory);

    expect(entries).toEqual([]);
    expect(runTestCompose).not.toHaveBeenCalled();
  });

  it('cleans even partially created Compose resources when container startup fails', async () => {
    vi.mocked(runTestCompose).mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_START_ERROR'));

    await expect(testPostgres(join(directory, 'postgres.json'))).rejects.toThrow('isolated_postgres_setup_failed');

    expect(vi.mocked(runTestCompose).mock.calls.at(-1)?.[1]).toEqual(['down', '--volumes', '--remove-orphans']);
  });

  it('waits for PostgreSQL readiness before migrating', async () => {
    boundary.failures = 1;
    const resource = await testPostgres();

    expect(delay).toHaveBeenCalledExactlyOnceWith(100, undefined, { signal: undefined });
    expect(boundary.clients[0].query).toHaveBeenCalledTimes(2);
    expect(migrate).toHaveBeenCalledOnce();

    await resource.stop();
  });

  it('bounds readiness retries and cleans the container and pool after a timeout', async () => {
    boundary.failures = 100;

    await expect(testPostgres()).rejects.toThrow('isolated_postgres_setup_failed');

    expect(boundary.clients[0].query).toHaveBeenCalledTimes(100);
    expect(delay).toHaveBeenCalledTimes(99);
    expect(boundary.clients[0].end).toHaveBeenCalledOnce();
    expect(migrate).not.toHaveBeenCalled();
  });

  it('sanitizes migration failure and closes the pool before container cleanup', async () => {
    vi.mocked(migrate).mockRejectedValue(new Error('SYNTHETIC_PRIVATE_MIGRATION_ERROR'));

    await expect(testPostgres()).rejects.toThrow('isolated_postgres_setup_failed');

    expect(boundary.clients[0].end).toHaveBeenCalledOnce();
    expect(vi.mocked(runTestCompose).mock.calls.at(-1)?.[1]).toEqual(['down', '--volumes', '--remove-orphans']);
  });
});

describe('Compose cleanup ownership', () => {
  it('rejects a directory outside the owned prefix before touching it', async () => {
    await expect(stopTestPostgres(directory, descriptor(directory))).rejects.toThrow('isolated_postgres_owner_invalid');

    expect(readFile).not.toHaveBeenCalled();
    expect(runTestCompose).not.toHaveBeenCalled();
  });

  it('rejects a descriptor for a different directory', async () => {
    const cluster = await owned();

    await expect(stopTestPostgres(cluster, descriptor(directory))).rejects.toThrow('isolated_postgres_owner_invalid');

    expect(runTestCompose).not.toHaveBeenCalled();
  });

  it('rejects an incorrect ownership marker without stopping or deleting anything', async () => {
    const cluster = await owned();

    await writeFile(join(cluster, 'test-owner'), 'different-owner');

    await expect(stopTestPostgres(cluster, descriptor(cluster))).rejects.toThrow('isolated_postgres_owner_invalid');

    expect(runTestCompose).not.toHaveBeenCalled();
    const retained = await stat(cluster);

    expect(retained.isDirectory()).toBe(true);
  });

  it('tolerates resources that are already gone', async () => {
    const cluster = join(directory, 'visomi-auth-test-gone');

    await stopTestPostgres(cluster, descriptor(cluster));

    expect(runTestCompose).not.toHaveBeenCalled();
  });

  it('propagates ownership marker read errors instead of deleting the directory', async () => {
    const cluster = await owned();
    const failure = Object.assign(new Error('synthetic_permission'), { code: 'EACCES' });

    vi.mocked(readFile).mockRejectedValueOnce(failure);

    await expect(stopTestPostgres(cluster, descriptor(cluster))).rejects.toBe(failure);

    expect(runTestCompose).not.toHaveBeenCalled();
  });

  it('preserves ownership after a failed cleanup so a later teardown can retry', async () => {
    const cluster = await owned();

    vi.mocked(runTestCompose).mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_STOP_ERROR'));

    await expect(stopTestPostgres(cluster, descriptor(cluster))).rejects.toThrow('isolated_postgres_cleanup_failed');

    const marker = await readFile(join(cluster, 'test-owner'), 'utf8');

    expect(marker).toBe('visomi-stack-isolated-postgres');

    await stopTestPostgres(cluster, descriptor(cluster));

    await expect(stat(cluster)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
