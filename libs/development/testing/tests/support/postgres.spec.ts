import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { testPostgres, stopTestPostgres } from './postgres';

const boundary = vi.hoisted(() => ({
  probe: { listen: vi.fn(), address: vi.fn(), close: vi.fn() },
  clients: [] as { query: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }[],
  failAdmin: false,
}));

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:net', () => ({ createServer: () => boundary.probe }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();

  return { ...actual, access: vi.fn(actual.access), readFile: vi.fn(actual.readFile) };
});
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: (options: unknown) => options }));
vi.mock('drizzle-orm/node-postgres/migrator', () => ({ migrate: vi.fn() }));
vi.mock('pg', () => ({
  Pool: vi.fn(function () {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), end: vi.fn().mockResolvedValue(undefined) };

    if (boundary.failAdmin) {
      client.query.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_DATABASE_ERROR'));
    }

    boundary.clients.push(client);

    return client;
  }),
}));

let directory: string;
const missing = () => Object.assign(new Error('synthetic_missing'), { code: 'ENOENT' });
const denied = () => Object.assign(new Error('synthetic_permission'), { code: 'EACCES' });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('PG_BIN', undefined);
  boundary.clients.length = 0;
  boundary.failAdmin = false;
  boundary.probe.listen.mockImplementation((_port, _host, ready) => ready());
  boundary.probe.address.mockReturnValue({ port: 54321 });
  boundary.probe.close.mockImplementation((closed) => closed());
  vi.mocked(execFile).mockImplementation(((
    _file: string,
    _args: string[],
    callback: (error: Error | null, stdout: string) => void,
  ) => callback(null, '')) as never);
  vi.mocked(migrate).mockReset().mockResolvedValue(undefined);
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

  vi.mocked(access).mockImplementation(actual.access);
  vi.mocked(readFile).mockImplementation(actual.readFile);
  const temporary = await mkdtemp(join(tmpdir(), 'visomi-postgres-unit-'));

  directory = temporary;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function owned(running = false) {
  const cluster = await mkdtemp(join(directory, 'visomi-auth-test-'));

  await writeFile(join(cluster, 'test-owner'), 'visomi-stack-isolated-postgres');
  if (running) {
    await mkdir(join(cluster, 'data'));
    await writeFile(join(cluster, 'data/postmaster.pid'), '991003');
  }

  return cluster;
}

describe('isolated PostgreSQL test resource', () => {
  it('creates an owned resource without consulting developer DATABASE_URL and closes each temporary pool', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://synthetic-developer-database/never-use');
    const resource = await testPostgres();

    try {
      expect(resource.url).toBe('postgresql://visomi_test@127.0.0.1:54321/visomi_auth_test');
      expect(boundary.probe.listen).toHaveBeenCalledWith(0, '127.0.0.1', expect.any(Function));
      expect(boundary.probe.close).toHaveBeenCalledOnce();
      expect(boundary.clients).toHaveLength(2);
      expect(boundary.clients.every((client) => client.end.mock.calls.length === 1)).toBe(true);
      expect(boundary.clients[0].query).toHaveBeenCalledExactlyOnceWith('CREATE DATABASE visomi_auth_test');
      const options = vi.mocked(migrate).mock.calls[0][1];

      expect(options.migrationsFolder).toMatch(/libs\/backend\/shared\/src\/lib\/database\/migrations$/);
      const first = resource.stop();

      expect(resource.stop()).toBe(first);
      await first;
      await expect(stat(resource.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(resource.directory, { recursive: true, force: true });
    }
  });

  it('records ownership before setup and honors the configured binary directory', async () => {
    vi.stubEnv('PG_BIN', '/synthetic/postgres/bin');
    const manifest = join(directory, 'postgres.json');
    const resource = await testPostgres(manifest);
    const text = await readFile(manifest, 'utf8');

    expect(JSON.parse(text)).toEqual({ directory: resource.directory, binary: '/synthetic/postgres/bin' });
    expect(vi.mocked(execFile).mock.calls[0][0]).toBe('/synthetic/postgres/bin/initdb');
    await resource.stop();
  });

  it.each([null, 'synthetic-unix-socket'])('rejects an unavailable TCP probe address: %s', async (address) => {
    boundary.probe.address.mockReturnValue(address);
    await expect(testPostgres(join(directory, 'postgres.json'))).rejects.toThrow('test_postgres_port_unavailable');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('removes a failed cluster without trying to stop a server that never started', async () => {
    vi.mocked(execFile).mockImplementationOnce(((_file: string, _args: string[], callback: (error: Error) => void) =>
      callback(new Error('SYNTHETIC_PRIVATE_INIT_FAILURE'))) as never);
    const manifest = join(directory, 'postgres.json');

    await expect(testPostgres(manifest)).rejects.toThrow('isolated_postgres_setup_failed');
    const text = await readFile(manifest, 'utf8');

    await expect(stat(JSON.parse(text).directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(execFile).toHaveBeenCalledOnce();
  });

  it.each(['database', 'migration'])('sanitizes %s setup failure and stops the started server', async (failure) => {
    boundary.failAdmin = failure === 'database';
    if (failure === 'migration') {
      vi.mocked(migrate).mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_MIGRATION_ERROR'));
    }

    const manifest = join(directory, 'postgres.json');

    await expect(testPostgres(manifest)).rejects.toThrow('isolated_postgres_setup_failed');
    expect(vi.mocked(execFile).mock.calls.at(-1)?.[1]).toContain('stop');
    expect(boundary.clients.every((client) => client.end.mock.calls.length === 1)).toBe(true);
    const text = await readFile(manifest, 'utf8');

    await expect(stat(JSON.parse(text).directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('PostgreSQL cleanup ownership', () => {
  it('rejects a path that lacks the isolated cluster prefix before touching it', async () => {
    await expect(stopTestPostgres(directory, '/synthetic/pg')).rejects.toThrow('isolated_postgres_owner_invalid');
    expect(readFile).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  });

  it('rejects an incorrect ownership marker without stopping or deleting anything', async () => {
    const cluster = await owned();

    await writeFile(join(cluster, 'test-owner'), 'different-owner');
    await expect(stopTestPostgres(cluster, '/synthetic/pg')).rejects.toThrow('isolated_postgres_owner_invalid');
    expect(execFile).not.toHaveBeenCalled();
    const retained = await stat(cluster);

    expect(retained.isDirectory()).toBe(true);
  });

  it('tolerates a cluster that is already gone', async () => {
    await stopTestPostgres(join(directory, 'visomi-auth-test-gone'), '/synthetic/pg');
    expect(execFile).not.toHaveBeenCalled();
  });

  it('propagates ownership marker read errors without deleting the directory', async () => {
    const cluster = await owned();
    const failure = denied();

    vi.mocked(readFile).mockRejectedValueOnce(failure);
    await expect(stopTestPostgres(cluster, '/synthetic/pg')).rejects.toBe(failure);
    const retained = await stat(cluster);

    expect(retained.isDirectory()).toBe(true);
  });

  it('propagates PID inspection errors instead of assuming the server is stopped', async () => {
    const cluster = await owned(true);
    const failure = denied();

    vi.mocked(access).mockRejectedValueOnce(failure);
    await expect(stopTestPostgres(cluster, '/synthetic/pg')).rejects.toBe(failure);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('removes an owned stopped cluster without invoking pg_ctl', async () => {
    const cluster = await owned();

    await stopTestPostgres(cluster, '/synthetic/pg');
    expect(execFile).not.toHaveBeenCalled();
    await expect(stat(cluster)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stops a running owned server before removing its directory', async () => {
    const cluster = await owned(true);

    await stopTestPostgres(cluster, '/synthetic/pg');
    expect(execFile).toHaveBeenCalledWith(
      '/synthetic/pg/pg_ctl',
      expect.arrayContaining(['-D', join(cluster, 'data'), 'stop']),
      expect.any(Function),
    );
    await expect(stat(cluster)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([false, true])('handles a failed stop while the server remains active: %s', async (active) => {
    const cluster = await owned(true);

    vi.mocked(execFile).mockImplementationOnce(((_file: string, _args: string[], callback: (error: Error) => void) =>
      callback(new Error('SYNTHETIC_PRIVATE_STOP_ERROR'))) as never);
    vi.mocked(access).mockResolvedValueOnce(undefined);
    if (active) {
      vi.mocked(access).mockResolvedValueOnce(undefined);
      await expect(stopTestPostgres(cluster, '/synthetic/pg')).rejects.toThrow('isolated_postgres_cleanup_failed');
      const retained = await stat(cluster);

      expect(retained.isDirectory()).toBe(true);
    } else {
      vi.mocked(access).mockRejectedValueOnce(missing());
      await stopTestPostgres(cluster, '/synthetic/pg');
      await expect(stat(cluster)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
});
