import { setTimeout as delay } from 'node:timers/promises';

import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { currentObservability, initializeObservability } from './observability';
import type { Observability, ObservabilityOptions } from './observability';

const marker = 'SYNTHETIC_CUSTOMER_SECRET_8d51';
let telemetry: Observability | undefined;

function fixture(overrides: Partial<ObservabilityOptions> = {}) {
  const lines: Record<string, unknown>[] = [];
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter: metrics, exportIntervalMillis: 60_000 });

  telemetry = initializeObservability({
    service: 'web-api',
    version: '0.0.1',
    environment: 'test',
    destination: { write: (line) => lines.push(JSON.parse(line)) },
    spanExporter: spans,
    metricReader: reader,
    ...overrides,
  });

  return { telemetry, lines, spans, metrics, reader };
}

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
  vi.unstubAllEnvs();
});

describe('observability runtime', () => {
  it('carries only technical context through serialized jobs and preserves application errors', async () => {
    const f = fixture();
    const http = f.telemetry.beginHttp();
    const carrier = http.run(() => f.telemetry.captureJobContext());
    const boundary = JSON.parse(JSON.stringify({ ...carrier, payload: marker, baggage: marker }));
    const failure = new Error(marker);
    const result = await f.telemetry.runJob(boundary, async () => {
      const current = f.telemetry.correlation();

      expect(current?.traceId).toBe(carrier?.traceId);
      expect(current?.requestId).toBe(carrier?.requestId);
      expect(current?.spanId).not.toBe(carrier?.spanId);

      return 'completed';
    });

    expect(result).toBe('completed');
    await expect(
      f.telemetry.runJob(boundary, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    http.finish('success', 200);
    const spans = f.spans.getFinishedSpans();

    expect(spans.filter((span) => span.name === 'job.execute')[0].parentSpanContext?.spanId).toBe(carrier?.spanId);
    expect(f.lines.map((line) => line.outcome)).toContain('job_failed');
    expect(JSON.stringify(f.lines)).not.toContain(marker);
    expect(f.telemetry.correlation()).toBeUndefined();
  });

  it('runtime-checks event names, codes, outcomes, and HTTP status before emission', () => {
    const f = fixture();
    const request = f.telemetry.beginHttp();

    f.telemetry.event(marker as never, marker as never);
    request.finish(marker as never, marker as never);
    expect(f.lines[0]).toMatchObject({ event: 'runtime.failed', code: 'none', msg: 'runtime.failed' });
    expect(f.lines[1]).toMatchObject({ event: 'http.request', outcome: 'server_error' });
    expect(f.lines[1]).not.toHaveProperty('status');
    expect(JSON.stringify(f.lines)).not.toContain(marker);
    expect(JSON.stringify(f.spans.getFinishedSpans()[0].attributes)).not.toContain(marker);
  });

  it('reuses one process runtime and isolates failing telemetry sinks', async () => {
    const f = fixture({
      destination: {
        write: () => {
          throw new Error(marker);
        },
      },
      spanExporter: {
        export: () => {
          throw new Error(marker);
        },
        shutdown: () => Promise.resolve(),
      },
    });

    expect(initializeObservability({ service: 'web-gateway', version: '0.0.1' })).toBe(f.telemetry);
    expect(currentObservability()).toBe(f.telemetry);
    expect(() => f.telemetry.event('runtime.started')).not.toThrow();
    const request = f.telemetry.beginHttp();

    request.run(() => expect(f.telemetry.correlation()).toBeDefined());
    expect(() => request.finish('success', 204)).not.toThrow();
    const result = await f.telemetry.runJob(undefined, async () => 42);

    expect(result).toBe(42);
  });

  it.each(['spans', 'metrics', 'logs'] as const)(
    'blocks reinitialization until delayed %s cleanup succeeds after timeout',
    async (sink) => {
      let release: () => void = () => undefined;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const destination = {
        write: () => undefined,
        flush: (callback: () => void) => {
          void pending.then(callback);
        },
      };
      const f = fixture(sink === 'logs' ? { destination } : {});
      const exporter = sink === 'spans' ? f.spans : f.metrics;
      const originalShutdown = exporter.shutdown.bind(exporter);
      const cleanup =
        sink === 'logs'
          ? vi.spyOn(destination, 'flush')
          : vi.spyOn(exporter, 'shutdown').mockImplementation(async () => {
              await pending;
              await originalShutdown();
            });

      try {
        const started = performance.now();
        const first = f.telemetry.shutdown(30);
        const initialize = () => initializeObservability({ service: 'worker', version: '1.2.3' });

        expect(initialize).toThrow('observability_shutdown_incomplete');
        expect(f.telemetry.shutdown(30)).toBe(first);
        const flushed = await first;

        expect(flushed).toBe(false);
        expect(performance.now() - started).toBeLessThan(1000);
        await delay(10);
        expect(currentObservability()).toBe(f.telemetry);
        expect(initialize).toThrow('observability_shutdown_incomplete');
        expect(cleanup).toHaveBeenCalledOnce();
        release();
        await vi.waitFor(() => expect(currentObservability()).toBeUndefined());
        telemetry = initialize();

        expect(telemetry).not.toBe(f.telemetry);
        expect(f.telemetry.shutdown()).toBe(first);
        expect(currentObservability()).toBe(telemetry);
      } finally {
        release();
        await vi.waitFor(() => expect(currentObservability()).not.toBe(f.telemetry));
      }
    },
  );

  it('retains the first initialization and shuts each owned sink down once', async () => {
    const f = fixture();
    const ignoredWrite = vi.fn();
    const spanShutdown = vi.spyOn(f.spans, 'shutdown');
    const readerShutdown = vi.spyOn(f.reader, 'shutdown');
    const repeated = initializeObservability({
      service: 'worker',
      version: '1.2.3',
      environment: 'production',
      destination: { write: ignoredWrite },
    });

    expect(repeated).toBe(f.telemetry);
    repeated.event('runtime.started');
    expect(f.lines[0]).toMatchObject({ service: 'web-api', version: '0.0.1', environment: 'test' });
    expect(ignoredWrite).not.toHaveBeenCalled();
    const first = f.telemetry.shutdown();

    expect(repeated.shutdown()).toBe(first);
    const success = await first;

    expect(success).toBe(true);
    expect(spanShutdown).toHaveBeenCalledOnce();
    expect(readerShutdown).toHaveBeenCalledOnce();
    expect(currentObservability()).toBeUndefined();
    telemetry = initializeObservability({ service: 'worker', version: '1.2.3', destination: { write: ignoredWrite } });

    expect(telemetry).not.toBe(f.telemetry);
    expect(f.telemetry.shutdown()).toBe(first);
    expect(currentObservability()).toBe(telemetry);
  });

  it('supports every public method and request operation as a detached callback', async () => {
    const f = fixture();
    const { event, correlation, beginHttp, captureJobContext, runJob, shutdown } = f.telemetry;
    const { run, finish } = beginHttp();
    const parent = run(correlation);
    const carrier = run(captureJobContext);

    await Promise.resolve('runtime.started' as const).then(event);
    const child = await runJob(carrier, async () => {
      await delay(1);

      return correlation();
    });

    expect(child?.requestId).toBe(parent?.requestId);
    expect(child?.traceId).toBe(parent?.traceId);
    expect(child?.spanId).not.toBe(parent?.spanId);
    expect(correlation()).toBeUndefined();
    expect(captureJobContext()).toBeUndefined();
    finish('success', 200);
    finish('success', 200);
    expect(f.lines.filter((line) => line.event === 'http.request')).toHaveLength(1);
    expect(f.spans.getFinishedSpans()).toHaveLength(2);
    const first = shutdown();

    expect(shutdown()).toBe(first);
    const success = await first;

    expect(success).toBe(true);
  });

  it('isolates overlapping asynchronous jobs invoked through detached methods', async () => {
    const f = fixture();
    const { beginHttp, captureJobContext, correlation, runJob } = f.telemetry;
    const requests = [beginHttp(), beginHttp()];
    const carriers = requests.map((request) => request.run(captureJobContext));
    const results = await Promise.all(
      carriers.map((carrier, index) =>
        runJob(carrier, async () => {
          const before = correlation();

          await delay(index === 0 ? 10 : 1);
          const after = correlation();

          expect(after).toEqual(before);
          expect(after?.requestId).toBe(carrier?.requestId);
          expect(after?.traceId).toBe(carrier?.traceId);

          return after;
        }),
      ),
    );

    expect(new Set(results.map((result) => result?.requestId)).size).toBe(2);
    expect(new Set(results.map((result) => result?.traceId)).size).toBe(2);
    expect(correlation()).toBeUndefined();
    requests.forEach((request) => request.finish('success', 200));
    expect(f.spans.getFinishedSpans()).toHaveLength(4);
  });
  it('starts a fresh job for invalid carriers and records each job metric once', async () => {
    const f = fixture();
    const invalid = { version: 1, requestId: 'SYNTHETIC_PRIVATE_MARKER', traceId: 'f'.repeat(32) };
    const result = await f.telemetry.runJob(invalid, async () => f.telemetry.correlation());

    expect(result?.traceId).not.toBe(invalid.traceId);
    expect(result?.requestId).not.toBe(invalid.requestId);
    expect(Object.isFrozen(result)).toBe(true);
    await f.reader.forceFlush();
    const metrics = f.metrics.getMetrics()[0].scopeMetrics[0].metrics;
    const count = metrics.find((metric) => metric.descriptor.name === 'job.executions');
    const duration = metrics.find((metric) => metric.descriptor.name === 'job.duration');

    expect(count?.dataPoints).toEqual([
      expect.objectContaining({
        value: 1,
        attributes: { operation: 'job.execute', outcome: 'success' },
      }),
    ]);
    expect(duration?.dataPoints).toHaveLength(1);
    expect(f.spans.getFinishedSpans()[0].parentSpanContext).toBeUndefined();
    expect(JSON.stringify(f.lines)).not.toContain('SYNTHETIC_PRIVATE_MARKER');
  });

  it('does not emit a pending operation completion after shutdown has completed', async () => {
    const f = fixture();
    const request = f.telemetry.beginHttp();
    const success = await f.telemetry.shutdown();

    expect(success).toBe(true);
    request.finish('success', 200);
    request.finish('server_error', 500);
    expect(f.lines).toHaveLength(0);
    expect(f.spans.getFinishedSpans()).toHaveLength(0);
  });
});
