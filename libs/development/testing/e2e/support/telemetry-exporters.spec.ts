import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTelemetryOptions } from './telemetry-exporters';
import { readTelemetry } from './telemetry';

import { initializeObservability } from '@visomi-stack/web-backend-shared';
import type { Observability } from '@visomi-stack/web-backend-shared';

let directory: string | undefined;
let runtime: Observability | undefined;

afterEach(async () => {
  await runtime?.shutdown();
  runtime = undefined;
  if (directory) {
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

describe('local test exporters', () => {
  it('holds span delivery until flush and drains pending metrics through the owning runtime shutdown', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'visomi-telemetry-exporters-'));

    directory = temporary;
    runtime = initializeObservability(createTelemetryOptions(directory, 'web-api', { holdSpans: true }));
    runtime.event('runtime.started');
    const request = runtime.beginHttp();

    request.finish('success', 200);
    const pending = await readTelemetry(directory);

    expect(pending.logs.map((entry) => entry.event)).toEqual(['runtime.started', 'http.request']);
    expect(pending.pending).toContainEqual({ file: 'spans.jsonl' });
    expect(pending.spans).toHaveLength(0);
    const stopped = await runtime.shutdown(1000);
    const delivered = await readTelemetry(directory);

    expect(stopped).toBe(true);
    expect(delivered.spans).toHaveLength(1);
    expect(delivered.spans[0]).toMatchObject({ name: 'http.request', resource: { 'service.name': 'web-api' } });
    expect(delivered.metrics.length).toBeGreaterThan(0);
    expect(delivered.metrics[0].resource).toMatchObject({ attributes: { 'service.name': 'web-api' } });
  });
});
