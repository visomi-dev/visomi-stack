import { AsyncResource } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import express, { json } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpError,
  initializeObservability,
  httpObservability,
  operationalErrorHandler,
} from '@visomi-stack/web-backend-shared';
import type { Observability, ObservabilityOptions } from '@visomi-stack/web-backend-shared';

const marker = 'SYNTHETIC_CUSTOMER_SECRET_8d51';
let server: Server | undefined;
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

async function listen(app: ReturnType<typeof express>): Promise<string> {
  server = createServer(app);

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));

  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Missing test listener');
  }

  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) {
    server.closeAllConnections();

    await new Promise<void>((resolve) => server!.close(() => resolve()));

    server = undefined;
  }

  await telemetry?.shutdown();

  telemetry = undefined;
  vi.unstubAllEnvs();
});

describe('HTTP observability integration', () => {
  it('owns each completion once and re-enters the original context after an async boundary', async () => {
    const f = fixture();
    const app = express();
    const detached = new AsyncResource('detached-test-boundary');

    app.use(httpObservability(f.telemetry));
    app.use((_request, _response, next) =>
      detached.runInAsyncScope(() => {
        expect(f.telemetry.correlation()).toBeUndefined();
        setImmediate(next);
      }),
    );
    app.use(httpObservability(f.telemetry));
    app.get('/', (_request, response) => response.json(f.telemetry.correlation()));
    const origin = await listen(app);
    const response = await fetch(origin);
    const body = await response.json();

    await f.reader.forceFlush();

    expect(f.lines).toHaveLength(1);
    expect(f.lines[0].requestId).toBe(body.requestId);
    expect(response.headers.get('x-request-id')).toBe(body.requestId);
    expect(f.spans.getFinishedSpans()).toHaveLength(1);
    const count = f.metrics
      .getMetrics()[0]
      .scopeMetrics[0].metrics.find((metric) => metric.descriptor.name === 'http.server.requests');

    expect(count?.dataPoints[0].value).toBe(1);
    detached.emitDestroy();
  });

  it('records an aborted HTTP response once', async () => {
    const f = fixture();
    const app = express();

    app.use(httpObservability(f.telemetry));
    app.get('/', (_request, response) => {
      response.write('pending');
    });
    const origin = await listen(app);
    const response = await fetch(origin);

    await response.body!.cancel();

    await vi.waitFor(() => expect(f.lines).toHaveLength(1));

    expect(f.lines[0].outcome).toBe('aborted');
    expect(f.spans.getFinishedSpans()).toHaveLength(1);
  });

  it('isolates concurrent requests and ignores external request IDs, trace context, and baggage', async () => {
    const f = fixture();
    const app = express();

    app.use(httpObservability(f.telemetry));
    app.get('/:wait', async (request, response) => {
      const before = f.telemetry.correlation();

      await delay(Number(request.params.wait));

      response.json({ before, after: f.telemetry.correlation() });
    });
    const origin = await listen(app);
    const responses = await Promise.all(
      [15, 1, 8].map(async (wait) => {
        const response = await fetch(`${origin}/${wait}`, {
          headers: {
            'x-request-id': marker,
            traceparent: `00-${'f'.repeat(32)}-${'f'.repeat(16)}-01`,
            tracestate: `customer=${marker}`,
            baggage: `secret=${marker}`,
          },
        });
        const body = await response.json();

        expect(body.before).toEqual(body.after);
        expect(body.before.traceId).not.toBe('f'.repeat(32));

        return body.before;
      }),
    );

    expect(new Set(responses.map((item) => item.requestId)).size).toBe(3);
    expect(new Set(responses.map((item) => item.traceId)).size).toBe(3);
    expect(f.telemetry.correlation()).toBeUndefined();
    expect(JSON.stringify(f.lines)).not.toContain(marker);
  });

  it('excludes sensitive input from logs, spans, metrics, and resources', async () => {
    vi.stubEnv('OTEL_RESOURCE_ATTRIBUTES', `customer.name=${marker}`);
    vi.stubEnv('OTEL_SERVICE_NAME', marker);
    const f = fixture({ environment: marker, version: marker, service: marker as ObservabilityOptions['service'] });
    const app = express();

    app.use(httpObservability(f.telemetry));
    app.use(json());
    app.post('/sensitive/:customer', (_request, response) => response.json({ value: marker }));
    app.get('/error', () => {
      throw new Error(marker);
    });
    app.use((_request, response) => response.sendStatus(404));
    app.use(operationalErrorHandler);
    const origin = await listen(app);

    for (const path of [`/sensitive/${marker}?token=${marker}`, '/error', `/missing/${marker}`]) {
      const response = await fetch(`${origin}${path}`, {
        method: path.startsWith('/sensitive') ? 'POST' : 'GET',
        headers: {
          'content-type': 'application/json',
          cookie: `session=${marker}`,
          authorization: `Bearer ${marker}`,
          'user-agent': marker,
          'x-forwarded-for': marker,
        },
        body: path.startsWith('/sensitive') ? JSON.stringify({ customer: marker }) : undefined,
      });

      await response.text();
    }

    await f.reader.forceFlush();

    const spanOutput = f.spans.getFinishedSpans().map((span) => ({
      name: span.name,
      resource: span.resource.attributes,
      attributes: span.attributes,
      events: span.events,
      links: span.links,
      status: span.status,
    }));
    const metricOutput = f.metrics
      .getMetrics()
      .map((entry) => ({ resource: entry.resource.attributes, scopes: entry.scopeMetrics }));

    expect(JSON.stringify({ logs: f.lines, spans: spanOutput, metrics: metricOutput })).not.toContain(marker);
    expect(f.lines.map((line) => line.outcome)).toEqual(['success', 'server_error', 'client_error']);
    expect(spanOutput).toHaveLength(3);
    expect(spanOutput[0].resource).toEqual({
      'service.name': 'web-api',
      'service.version': 'unknown',
      'deployment.environment.name': 'unknown',
    });

    for (const line of f.lines) {
      expect(Object.keys(line).sort()).toEqual(
        [
          'duration',
          'environment',
          'event',
          'level',
          'msg',
          'outcome',
          'requestId',
          'service',
          'spanId',
          'status',
          'traceId',
          'version',
        ].sort(),
      );
    }

    const metrics = metricOutput[0].scopes[0].metrics;
    const duration = metrics.find((metric) => metric.descriptor.name === 'http.server.request.duration');

    expect(duration?.dataPoints).toHaveLength(3);

    for (const metric of metrics) {
      for (const point of metric.dataPoints) {
        expect(Object.keys(point.attributes).sort()).toEqual(['http.response.status_code', 'operation', 'outcome']);
      }
    }
  });

  it('keeps HTTP responses and job results intact when telemetry sinks throw', async () => {
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
    const app = express();

    app.use(httpObservability(f.telemetry));
    app.get('/', (_request, response) => response.sendStatus(204));
    const origin = await listen(app);
    const response = await fetch(origin);
    const result = await f.telemetry.runJob(undefined, async () => 42);

    expect(response.status).toBe(204);
    expect(result).toBe(42);
  });

  it('returns deliberate public error details without exporting them in telemetry', async () => {
    const f = fixture();
    const app = express();

    app.use(httpObservability(f.telemetry));
    app.get('/', () => {
      throw new HttpError(422, 'request_invalid', marker, { fields: [marker] });
    });
    app.use(operationalErrorHandler);
    const origin = await listen(app);
    const response = await fetch(origin);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toEqual({ error: 'request_invalid', message: marker, body: { fields: [marker] } });

    await f.reader.forceFlush();

    const spans = f.spans.getFinishedSpans().map((span) => ({
      attributes: span.attributes,
      events: span.events,
      status: span.status,
      resource: span.resource.attributes,
    }));

    expect(f.lines).toHaveLength(1);
    expect(f.lines[0]).toMatchObject({ outcome: 'client_error', status: 422 });
    expect(spans).toHaveLength(1);
    expect(JSON.stringify({ logs: f.lines, spans, metrics: f.metrics.getMetrics() })).not.toContain(marker);
  });

  it('keeps failed cleanup isolated and prevents another runtime from starting', () => {
    const source = fileURLToPath(
      new URL('../../../../../libs/web/backend/shared/src/lib/observability/lib/observability.ts', import.meta.url),
    );
    const script = `
      const { initializeObservability, currentObservability } = require(process.argv[1]);
      const options = {
        service: 'web-api', version: '0.0.1', destination: { write() {} },
        spanExporter: {
          export(_spans, callback) { callback({ code: 0 }); },
          shutdown() { return Promise.reject(new Error('synthetic_shutdown_failure')); }
        }
      };
      const runtime = initializeObservability(options);
      runtime.shutdown(30).then(success => {
        let blocked = false;
        try { initializeObservability(options); }
        catch (error) { blocked = error.message === 'observability_shutdown_incomplete'; }
        console.log(JSON.stringify({ success, blocked, retained: currentObservability() === runtime }));
      });
    `;
    const output = execFileSync(process.execPath, ['--import', 'tsx', '-e', script, source], {
      encoding: 'utf8',
      timeout: 5000,
    });

    expect(JSON.parse(output)).toEqual({ success: false, blocked: true, retained: true });
  });
});
