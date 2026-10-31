import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { gunzipSync } from 'node:zlib';

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import express, { json } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpObservability, operationalErrorHandler } from '../middleware/http';

import { initializeObservability } from './observability';
import type { Observability } from './observability';
import { otlpSpanProcessors } from './otlp';

const marker = 'SYNTHETIC_PRIVATE_OTLP_71d3';
const servers: Server[] = [];
let telemetry: Observability | undefined;

async function listen(server: Server): Promise<string> {
  servers.push(server);
  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

afterEach(async () => {
  await telemetry?.shutdown();

  telemetry = undefined;

  for (const server of servers.splice(0)) {
    server.closeAllConnections();

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('OTLP trace export', () => {
  it.each([undefined, 'false', 'TRUE'])('requires an explicit opt-in: %s', (enabled) => {
    expect(otlpSpanProcessors({ VISOMI_OTLP_TRACING: enabled })).toEqual([]);
  });

  it.each([
    { OTEL_EXPORTER_OTLP_ENDPOINT: undefined },
    { OTEL_EXPORTER_OTLP_ENDPOINT: marker },
    { OTEL_EXPORTER_OTLP_ENDPOINT: 'file:///synthetic' },
    { OTEL_EXPORTER_OTLP_ENDPOINT: `http://${marker}@localhost` },
    { OTEL_EXPORTER_OTLP_ENDPOINT: `http://user:${marker}@localhost` },
    { OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost/?token=${marker}` },
    { OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost/#${marker}` },
    { OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc' },
    { OTEL_EXPORTER_OTLP_HEADERS: undefined },
  ])('rejects incomplete or unsafe transport configuration without exposing it: %#', (override) => {
    const env = {
      VISOMI_OTLP_TRACING: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_HEADERS: `authorization=${marker}`,
      ...override,
    };

    expect(() => otlpSpanProcessors(env)).toThrow('observability_configuration_invalid');
  });

  it('accepts an HTTPS receiver without opening a connection before there are spans', async () => {
    const processors = otlpSpanProcessors({
      VISOMI_OTLP_TRACING: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://receiver.invalid/',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization=synthetic',
    });

    expect(processors).toHaveLength(1);

    await processors[0].shutdown();
  });

  it.each([200, 503])(
    'exports only approved HTTP/job spans over OTLP and isolates receiver status %s',
    async (status) => {
      const requests: { path: string; contentType: string; authorization: string; body: Buffer }[] = [];
      const receiver = await listen(
        createServer(async (request, response) => {
          const chunks: Buffer[] = [];

          for await (const chunk of request) {
            chunks.push(chunk);
          }

          const bytes = Buffer.concat(chunks);

          requests.push({
            path: request.url!,
            contentType: request.headers['content-type']!,
            authorization: request.headers.authorization!,
            body: request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes,
          });
          response.writeHead(status, { 'content-type': 'application/x-protobuf' });
          response.end();
        }),
      );

      for (const [key, value] of Object.entries({
        VISOMI_OTLP_TRACING: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: `${receiver}/`,
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
        OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20SYNTHETIC_RECEIVER_CREDENTIAL',
        OTEL_RESOURCE_ATTRIBUTES: `customer=${marker}`,
        OTEL_SERVICE_NAME: marker,
        OTEL_SERVICE_VERSION: marker,
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${receiver}/unexpected`,
      })) {
        vi.stubEnv(key, value);
      }

      const exported = vi.spyOn(OTLPTraceExporter.prototype, 'export');
      const lines: unknown[] = [];

      telemetry = initializeObservability({
        service: 'web-gateway',
        version: '0.0.1',
        environment: 'test',
        destination: { write: (line) => lines.push(JSON.parse(line)) },
      });
      const runtime = telemetry;
      const app = express();

      app.use(httpObservability(runtime));
      app.use(json());
      app.post('/private/:customer', async (_request, response) => {
        await runtime.runJob(undefined, async () => 'completed');

        response.json({ customer: marker });
      });
      app.get('/error', () => {
        throw new Error(marker);
      });
      app.use(operationalErrorHandler);
      const origin = await listen(createServer(app));
      const clientTrace = 'f'.repeat(32);
      const response = await fetch(`${origin}/private/${marker}?token=${marker}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `session=${marker}`,
          authorization: `Bearer ${marker}`,
          'user-agent': marker,
          'x-forwarded-for': '192.0.2.100',
          'x-request-id': marker,
          traceparent: `00-${clientTrace}-${'f'.repeat(16)}-01`,
          tracestate: `private=${marker}`,
          baggage: `private=${marker}`,
        },
        body: JSON.stringify({ private: marker }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body).toEqual({ customer: marker });
      const failed = await fetch(`${origin}/error`);

      expect(failed.status).toBe(500);

      await failed.text();

      const started = performance.now();

      await runtime.shutdown();

      expect(performance.now() - started).toBeLessThan(1500);
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((request) => request.path === '/v1/traces')).toBe(true);
      expect(requests[0].contentType).toBe('application/x-protobuf');
      expect(requests[0].authorization).toBe('Bearer SYNTHETIC_RECEIVER_CREDENTIAL');
      const spans = exported.mock.calls.flatMap(([spans]) => spans);

      expect(spans.map((span) => span.name).sort()).toEqual(['http.request', 'http.request', 'job.execute']);
      for (const span of spans) {
        expect(Object.keys(span.attributes).sort()).toEqual(
          span.name === 'http.request'
            ? ['http.response.status_code', 'operation', 'outcome']
            : ['operation', 'outcome'],
        );
        expect(span.resource.attributes).toEqual({
          'service.name': 'web-gateway',
          'service.version': '0.0.1',
          'deployment.environment.name': 'test',
        });
        expect(span.events).toEqual([]);
        expect(span.links).toEqual([]);
        expect(span.status.message).toBeUndefined();
        expect(span.spanContext().traceId).not.toBe(clientTrace);
        expect(span.spanContext().traceState).toBeUndefined();
      }
      const wire = Buffer.concat(requests.map((request) => request.body)).toString('utf8');

      expect(wire).toContain('http.request');
      expect(wire).toContain('job.execute');
      for (const forbidden of [
        marker,
        '192.0.2.100',
        'SYNTHETIC_RECEIVER_CREDENTIAL',
        'exception.message',
        'exception.stacktrace',
        'url.full',
        'url.path',
        'http.request.body',
        'customer',
        'process.pid',
        'host.name',
      ]) {
        expect(wire).not.toContain(forbidden);
        expect(JSON.stringify(lines)).not.toContain(forbidden);
      }
    },
  );
});
