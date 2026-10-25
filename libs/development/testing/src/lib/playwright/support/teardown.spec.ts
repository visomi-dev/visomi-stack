import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stopTestPostgres } from '../../postgres';

import teardown from './teardown';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn() }));
vi.mock('../../postgres', () => ({ stopTestPostgres: vi.fn() }));

const owner = { pid: 991001, parentPid: 991002 };
const cluster = { directory: '/synthetic/visomi-auth-test-owned', binary: '/synthetic/pg' };
const missing = () => Object.assign(new Error('synthetic_missing'), { code: 'ENOENT' });
let signal: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VISOMI_E2E_TELEMETRY_DIR', '/synthetic/telemetry');
  vi.mocked(delay).mockResolvedValue(undefined);
  vi.mocked(readFile).mockImplementation(async (file) =>
    JSON.stringify(String(file).endsWith('owner.json') ? owner : cluster),
  );
  vi.mocked(stopTestPostgres).mockResolvedValue(undefined);
  signal = vi.spyOn(process, 'kill').mockImplementation((_pid, name) => {
    if (name === 0) {
      throw Object.assign(new Error('synthetic_exited'), { code: 'ESRCH' });
    }

    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('owned E2E process teardown', () => {
  it('does nothing without an isolated run directory', async () => {
    vi.stubEnv('VISOMI_E2E_TELEMETRY_DIR', undefined);
    await teardown();
    expect(readFile).not.toHaveBeenCalled();
    expect(signal).not.toHaveBeenCalled();
    expect(stopTestPostgres).not.toHaveBeenCalled();
  });

  it('stops the watcher and app before cleaning the recorded database', async () => {
    await teardown();
    expect(signal.mock.calls).toEqual([
      [owner.parentPid, 'SIGTERM'],
      [owner.pid, 'SIGTERM'],
      [owner.pid, 0],
    ]);
    expect(stopTestPostgres).toHaveBeenCalledExactlyOnceWith(cluster.directory, cluster.binary);
    expect(signal.mock.invocationCallOrder.at(-1)).toBeLessThan(
      vi.mocked(stopTestPostgres).mock.invocationCallOrder[0],
    );
  });

  it.each(['owner.json', 'postgres.json'])('tolerates a missing %s manifest', async (file) => {
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith(file)) {
        throw missing();
      }

      return JSON.stringify(file === 'owner.json' ? cluster : owner);
    });
    await teardown();
    expect(signal).toHaveBeenCalledTimes(file === 'owner.json' ? 0 : 3);
    expect(stopTestPostgres).toHaveBeenCalledTimes(file === 'owner.json' ? 1 : 0);
  });

  it('tolerates processes that exited before either termination signal', async () => {
    signal.mockImplementation(() => {
      throw Object.assign(new Error('synthetic_exited'), { code: 'ESRCH' });
    });
    await teardown();
    expect(stopTestPostgres).toHaveBeenCalledOnce();
  });

  it('bounds graceful termination and kills only the recorded application if it stays alive', async () => {
    signal.mockReturnValue(true);
    await teardown();
    expect(delay).toHaveBeenCalledTimes(60);
    expect(signal).toHaveBeenLastCalledWith(owner.pid, 'SIGKILL');
    expect(stopTestPostgres).toHaveBeenCalledOnce();
  });

  it('still cleans the database after signaling fails and preserves the first failure', async () => {
    const failure = Object.assign(new Error('synthetic_permission_denied'), { code: 'EPERM' });

    signal.mockImplementation(() => {
      throw failure;
    });
    vi.mocked(stopTestPostgres).mockRejectedValue(new Error('synthetic_database_failure'));
    await expect(teardown()).rejects.toBe(failure);
    expect(stopTestPostgres).toHaveBeenCalledOnce();
  });

  it.each(['owner.json', 'postgres.json'])(
    'reports errors reading %s instead of treating them as missing',
    async (file) => {
      const failure = Object.assign(new Error('synthetic_manifest_denied'), { code: 'EACCES' });

      vi.mocked(readFile).mockImplementation(async (path) => {
        if (String(path).endsWith(file)) {
          throw failure;
        }

        return JSON.stringify(file === 'owner.json' ? cluster : owner);
      });
      await expect(teardown()).rejects.toBe(failure);
      expect(stopTestPostgres).toHaveBeenCalledTimes(file === 'owner.json' ? 1 : 0);
    },
  );

  it('reports malformed owner data while still attempting database cleanup', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('{invalid');
    await expect(teardown()).rejects.toBeInstanceOf(SyntaxError);
    expect(stopTestPostgres).toHaveBeenCalledOnce();
  });
});
