import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const extend = vi.hoisted(() => vi.fn((fixtures: Record<string, (...args: unknown[]) => unknown>) => fixtures));

vi.mock('@playwright/test', () => ({ test: { extend }, expect: {} }));

import './telemetry';

const fixture = extend.mock.calls[0][0].telemetry;
let directory: string | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

describe('shared Playwright telemetry fixture', () => {
  it('fails before use when no isolated destination is configured', async () => {
    vi.stubEnv('VISOMI_E2E_TELEMETRY_DIR', undefined);
    const use = vi.fn();

    await expect(fixture({}, use)).rejects.toThrow('isolated_telemetry_directory_required');
    expect(use).not.toHaveBeenCalled();
  });

  it('binds reads lazily to its destination and allows a separately owned process destination', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'visomi-fixture-'));

    directory = temporary;
    vi.stubEnv('VISOMI_E2E_TELEMETRY_DIR', directory);
    const use = vi.fn(async (telemetry) => {
      expect(telemetry.directory).toBe(directory);
      await writeFile(join(temporary, 'logs.jsonl'), '{"event":"runtime.started"}\n');
      const first = await telemetry.read();
      const other = await telemetry.read(join(temporary, 'not-yet-exported'));

      expect(first.logs).toEqual([{ event: 'runtime.started' }]);
      expect(other.logs).toEqual([]);
    });

    await fixture({}, use);
    expect(use).toHaveBeenCalledOnce();
  });
});
