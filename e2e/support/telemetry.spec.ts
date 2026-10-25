import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readTelemetry } from './telemetry';

let directory: string;

beforeEach(async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'visomi-telemetry-reader-'));

  directory = temporary;
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('isolated telemetry file reader', () => {
  it('treats not-yet-exported files as empty without inventing records', async () => {
    const telemetry = await readTelemetry(directory);

    expect(telemetry).toEqual({ logs: [], spans: [], metrics: [], pending: [] });
  });

  it('reads JSONL records and flattens exported span batches from the selected destination', async () => {
    await writeFile(join(directory, 'logs.jsonl'), '{"event":"runtime.started"}\n{"event":"http.request"}\n');
    await writeFile(join(directory, 'spans.jsonl'), '[{"name":"http.request"}]\n[]\n');
    await writeFile(join(directory, 'metrics.jsonl'), '{"scopeMetrics":[]}\n');
    await writeFile(join(directory, 'pending.jsonl'), '{"file":"spans.jsonl"}\n');
    const telemetry = await readTelemetry(directory);

    expect(telemetry).toEqual({
      logs: [{ event: 'runtime.started' }, { event: 'http.request' }],
      spans: [{ name: 'http.request' }],
      metrics: [{ scopeMetrics: [] }],
      pending: [{ file: 'spans.jsonl' }],
    });
  });

  it('surfaces invalid exporter output instead of silently losing coverage', async () => {
    await writeFile(join(directory, 'spans.jsonl'), '{invalid');
    await expect(readTelemetry(directory)).rejects.toThrow(SyntaxError);
  });
});
