import { writeFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runTestCompose } from '../../compose';
import { testPostgres } from '../../postgres';

import { serveTestApplication } from './serve';

vi.mock('node:fs/promises', () => ({ writeFile: vi.fn() }));
vi.mock('../../compose', () => ({ runTestCompose: vi.fn() }));
vi.mock('../../postgres', () => ({ testPostgres: vi.fn() }));

const stop = vi.fn();
const compose = {
  provider: 'docker' as const,
  project: 'visomi-auth-test-owned',
  directory: '/synthetic/visomi-auth-test-owned',
  telemetryDirectory: '/synthetic/telemetry',
  app: 'web-api' as const,
};
let handlers: Map<string | symbol, () => void>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VISOMI_E2E_TELEMETRY_DIR', '/synthetic/telemetry');
  handlers = new Map();
  vi.spyOn(process, 'once').mockImplementation((event, listener) => {
    handlers.set(event, listener);

    return process;
  });
  stop.mockResolvedValue(undefined);
  vi.mocked(testPostgres).mockResolvedValue({
    directory: compose.directory,
    compose,
    url: 'postgresql://synthetic-test',
    stop,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Compose E2E server lifecycle', () => {
  it('requires an isolated telemetry directory before starting resources', async () => {
    vi.stubEnv('VISOMI_E2E_TELEMETRY_DIR', undefined);
    await expect(serveTestApplication('web-api')).rejects.toThrow('isolated_telemetry_directory_required');
    expect(testPostgres).not.toHaveBeenCalled();
  });

  it.each(['SIGINT', 'SIGTERM'])('builds the selected app and cleans owned resources after %s', async (signal) => {
    const serving = serveTestApplication('web-gateway');

    await vi.waitFor(() => expect(runTestCompose).toHaveBeenCalledTimes(3));
    expect(testPostgres).toHaveBeenCalledExactlyOnceWith(
      '/synthetic/telemetry/postgres.json',
      'web-gateway',
      expect.any(AbortSignal),
    );
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(
      '/synthetic/telemetry/database.json',
      JSON.stringify({ url: 'postgresql://synthetic-test' }),
    );
    expect(vi.mocked(runTestCompose).mock.calls).toEqual([
      [compose, ['build', 'database-init', 'app'], expect.any(AbortSignal)],
      [compose, ['run', '--rm', '--no-deps', 'database-init'], expect.any(AbortSignal)],
      [compose, ['up', '-d', '--no-deps', 'app'], expect.any(AbortSignal)],
    ]);
    handlers.get(signal)!();
    handlers.get(signal)!();
    await serving;
    expect(stop).toHaveBeenCalledOnce();
  });

  it('cleans PostgreSQL if the app image fails to build or start', async () => {
    const failure = new Error('synthetic_build_failure');

    vi.mocked(runTestCompose).mockRejectedValueOnce(failure);
    await expect(serveTestApplication('web-api')).rejects.toBe(failure);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not start the application when the database initializer fails', async () => {
    const failure = new Error('synthetic_migration_failure');

    vi.mocked(runTestCompose).mockResolvedValueOnce({ stdout: '', stderr: '' }).mockRejectedValueOnce(failure);
    await expect(serveTestApplication('web-api')).rejects.toBe(failure);
    expect(runTestCompose).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('releases the wrapper timer and containers only when the runner signals shutdown', async () => {
    vi.useFakeTimers();
    const serving = serveTestApplication('web-api');

    await vi.waitFor(() => expect(runTestCompose).toHaveBeenCalledTimes(3));
    await vi.advanceTimersByTimeAsync(1000);
    expect(stop).not.toHaveBeenCalled();
    handlers.get('SIGTERM')!();
    await serving;
    expect(vi.getTimerCount()).toBe(0);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('cleans a database that finishes starting after the runner already cancelled', async () => {
    const serving = serveTestApplication('web-api');
    const rejected = expect(serving).rejects.toMatchObject({ name: 'AbortError' });

    handlers.get('SIGINT')!();
    await rejected;
    expect(runTestCompose).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('aborts a pending build on cancellation and still cleans its database', async () => {
    const failure = new Error('synthetic_build_aborted');

    vi.mocked(runTestCompose).mockImplementationOnce(
      (_owner, _args, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(failure), { once: true });
        }),
    );
    const serving = serveTestApplication('web-api');
    const rejected = expect(serving).rejects.toBe(failure);

    await vi.waitFor(() => expect(runTestCompose).toHaveBeenCalledOnce());
    handlers.get('SIGTERM')!();
    await rejected;
    expect(stop).toHaveBeenCalledOnce();
  });

  it('releases runner ownership when database setup fails before a resource is returned', async () => {
    const failure = new Error('synthetic_database_failure');

    vi.mocked(testPostgres).mockRejectedValueOnce(failure);
    await expect(serveTestApplication('web-api')).rejects.toBe(failure);
    expect(runTestCompose).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('reports cleanup failure instead of silently leaving containers alive', async () => {
    const failure = new Error('synthetic_cleanup_failure');
    const serving = serveTestApplication('web-api');
    const rejected = expect(serving).rejects.toBe(failure);

    await vi.waitFor(() => expect(runTestCompose).toHaveBeenCalledTimes(3));
    stop.mockRejectedValue(failure);
    handlers.get('SIGTERM')!();
    await rejected;
  });
});
