import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeObservability } from '../lib/observability';
import { httpObservability } from '../middleware/http';

import { createBrowserTelemetry } from './intake';

vi.mock('node:crypto', async (original) => {
  const crypto = await original<typeof import('node:crypto')>();

  return { ...crypto, randomBytes: () => Buffer.alloc(32, 42) };
});

const marker = 'SYNTHETIC_CUSTOMER_SECRET_71d3';
const asset = 'a'.repeat(64);
const origin = 'https://frontend.example.test';
const report = { application: 'web-site', code: 'unhandled_exception', kind: 'TypeError', screen: 'ui' };
const cleanup: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) {
    await close();
  }
  vi.useRealTimers();
});

async function fixture(useClock = true, includeApp = false, performance = false) {
  if (useClock) {
    vi.useFakeTimers({ toFake: ['Date'] });
  }

  const spans = new InMemorySpanExporter();
  const lines: string[] = [];
  const runtime = initializeObservability({
    service: 'web-gateway',
    version: '0.0.1',
    spanExporter: spans,
    destination: { write: (line) => lines.push(line) },
  });
  let now = Date.now();
  const telemetry = createBrowserTelemetry({
    observability: runtime,
    origin,
    performance,
    assets: {
      'web-site': new Map([[asset, { paths: ['/_astro/synthetic.js'], lines: [100, 10] }]]),
      ...(includeApp
        ? { 'web-app': new Map([['b'.repeat(64), { paths: ['/app/en/synthetic.js'], lines: [50] }]]) }
        : {}),
    },
    ...(useClock ? { now: () => now } : {}),
  });
  const app = express();

  app.use(httpObservability(runtime));
  app.use(telemetry.context);
  app.use('/telemetry', telemetry.router);
  app.get(['/api/failure', '/api'], (_request, response) => response.sendStatus(503));
  const server = createServer(app);

  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  cleanup.push(() => runtime.shutdown());
  cleanup.push(async () => telemetry.close());
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const configuration = await fetch(url + '/telemetry/config');
  const config = await configuration.json();
  const send = (body: unknown = report, headers: Record<string, string> = {}, path = '/errors') =>
    fetch(url + '/telemetry' + path, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-browser-telemetry': config.token,
        cookie: marker,
        authorization: `Bearer ${marker}`,
        'user-agent': marker,
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  return {
    spans,
    lines,
    runtime,
    config,
    url,
    send,
    configuration,
    advance: (ms: number) => {
      now += ms;
      vi.setSystemTime(now);
    },
  };
}

function signed(value: unknown): string {
  const body = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

  return `${body}.${createHmac('sha256', Buffer.alloc(32, 42)).update(body).digest('base64url')}`;
}

describe('private browser error intake', () => {
  it('accepts only Angular route measurements and never exports navigation material', async () => {
    const f = await fixture(true, true, true);
    const body = {
      application: 'web-app',
      screen: 'home',
      measurements: [
        { name: 'route_completed', value: 25.123 },
        { name: 'route_cancelled', value: 12 },
        { name: 'route_failed', value: 15 },
      ],
    };
    const accepted = await f.send(body, {}, '/performance');
    const astro = await f.send({ ...body, application: 'web-site' }, {}, '/performance');
    const privateData = await f.send({ ...body, navigationId: 1, url: marker, reason: marker }, {}, '/performance');

    expect([accepted.status, astro.status, privateData.status]).toEqual([202, 400, 400]);
    const span = f.spans.getFinishedSpans().find((span) => span.name === 'frontend.performance')!;

    expect(span.attributes).toEqual({
      operation: 'frontend.performance',
      outcome: 'success',
      'frontend.application': 'web-app',
      'frontend.screen': 'home',
      'frontend.performance.route_completed': 25.12,
      'frontend.performance.route_cancelled': 12,
      'frontend.performance.route_failed': 15,
    });
    expect(JSON.stringify(span.attributes) + f.lines.join('')).not.toContain(marker);
  });
  it('requires a separate performance opt-in and accepts only approved measurements from both applications', async () => {
    const f = await fixture(true, true, true);

    expect(f.config.performance).toBe(true);
    for (const application of ['web-app', 'web-site']) {
      const response = await f.send(
        {
          application,
          screen: 'unknown',
          measurements: [
            { name: 'cls', value: 0.123456 },
            { name: 'lcp', value: 120.123 },
          ],
        },
        { traceparent: `00-${'f'.repeat(32)}-${'f'.repeat(16)}-01` },
        '/performance',
      );

      expect(response.status).toBe(202);
    }
    const spans = f.spans.getFinishedSpans().filter((span) => span.name === 'frontend.performance');

    expect(spans).toHaveLength(2);
    expect(spans[0].attributes).toEqual({
      operation: 'frontend.performance',
      outcome: 'success',
      'frontend.application': 'web-app',
      'frontend.screen': 'unknown',
      'frontend.performance.cls': 0.1235,
      'frontend.performance.lcp': 120.12,
    });
    expect(spans.every((span) => !span.parentSpanContext && span.events.length === 0 && span.links.length === 0)).toBe(
      true,
    );
    expect(spans[0].spanContext().traceId).not.toBe('f'.repeat(32));
    expect(
      JSON.stringify(spans.map((span) => ({ attributes: span.attributes, events: span.events, links: span.links }))) +
        f.lines.join(''),
    ).not.toContain(marker);
  });

  it.each([
    { application: 'worker', screen: 'home', measurements: [{ name: 'lcp', value: 1 }] },
    { application: 'web-app', screen: marker, measurements: [{ name: 'lcp', value: 1 }] },
    { application: 'web-site', screen: 'home', url: marker, measurements: [{ name: 'lcp', value: 1 }] },
    { application: 'web-site', screen: 'home', measurements: [{ name: marker, value: 1 }] },
    { application: 'web-site', screen: 'home', measurements: [{ name: 'lcp', value: marker }] },
    { application: 'web-site', screen: 'home', measurements: [{ name: 'lcp', value: -1 }] },
    { application: 'web-site', screen: 'home', measurements: [{ name: 'lcp', value: 300001 }] },
    { application: 'web-site', screen: 'home', measurements: [{ name: 'cls', value: 11 }] },
    { application: 'web-site', screen: 'home', measurements: [{ name: 'cls', value: null }] },
    { application: 'web-site', screen: 'home', measurements: [{ name: 'lcp', value: 1, attribution: marker }] },
    {
      application: 'web-site',
      screen: 'home',
      measurements: [
        { name: 'lcp', value: 1 },
        { name: 'lcp', value: 2 },
      ],
    },
    { application: 'web-site', screen: 'home', measurements: [] },
  ])('rejects uncontrolled performance data %j', async (body) => {
    const f = await fixture(true, false, true);
    const response = await f.send(body, {}, '/performance');

    expect(response.status).toBe(400);
    expect(f.spans.getFinishedSpans().some((span) => span.name === 'frontend.performance')).toBe(false);
  });

  it('applies performance origin/permit and opt-in checks before accepting reports', async () => {
    const f = await fixture();
    const body = { application: 'web-site', screen: 'home', measurements: [{ name: 'lcp', value: 1 }] };

    expect(f.config).not.toHaveProperty('performance');
    const disabled = await f.send(body, {}, '/performance');
    const invalidPermit = await f.send(body, { 'x-browser-telemetry': marker }, '/performance');
    const invalidOrigin = await f.send(body, { origin: marker }, '/performance');

    expect(disabled.status).toBe(400);
    expect(invalidPermit.status).toBe(403);
    expect(invalidOrigin.status).toBe(403);
  });

  it('bounds performance intake without spending the error/configuration budget', async () => {
    const f = await fixture(true, false, true);
    const body = { application: 'web-site', screen: 'home', measurements: [{ name: 'lcp', value: 120 }] };

    for (let count = 0; count < 120; count++) {
      const response = await f.send(body, {}, '/performance');

      expect(response.status).toBe(202);
    }
    const limited = await f.send(body, {}, '/performance');
    const error = await f.send();

    expect(limited.status).toBe(429);
    expect(error.status).toBe(202);
  });
  it('shares an intake across both applications while isolating assets and release fingerprints', async () => {
    const f = await fixture(true, true);
    const appAsset = 'b'.repeat(64);

    expect(f.config.assets).toEqual([
      { id: asset, path: '/_astro/synthetic.js' },
      { id: appAsset, path: '/app/en/synthetic.js' },
    ]);
    const angular = await f.send({
      ...report,
      application: 'web-app',
      location: { asset: appAsset, line: 1, column: 1 },
    });
    const astro = await f.send({ ...report, location: { asset, line: 1, column: 1 } });
    const wrongApp = await f.send({ ...report, application: 'web-app', location: { asset, line: 1, column: 1 } });
    const wrongSite = await f.send({ ...report, location: { asset: appAsset, line: 1, column: 1 } });

    expect([angular.status, astro.status, wrongApp.status, wrongSite.status]).toEqual([202, 202, 400, 400]);
    const errors = f.spans.getFinishedSpans().filter((span) => span.name === 'frontend.error');

    expect(errors.map((span) => span.attributes['frontend.application'])).toEqual(['web-app', 'web-site']);
    expect(errors[0].attributes['frontend.release']).not.toBe(errors[1].attributes['frontend.release']);
    expect(JSON.stringify(errors.map((span) => span.attributes))).not.toContain(marker);
  });
  it('exports only verified fields, correlates server-issued context, and never adopts incoming traceparent', async () => {
    const f = await fixture();
    const response = await fetch(f.url + '/api/failure', {
      headers: { traceparent: `00-${'f'.repeat(32)}-${'f'.repeat(16)}-01`, 'x-request-id': marker },
    });
    const correlated = await f.send({
      ...report,
      code: 'request_failed',
      correlation: response.headers.get('x-telemetry-context'),
      location: { asset, line: 2, column: 11 },
    });
    const standalone = await f.send({ ...report, correlation: marker });
    const spans = f.spans.getFinishedSpans();
    const request = spans.find((span) => span.attributes['http.response.status_code'] === 503)!;
    const errors = spans.filter((span) => span.name === 'frontend.error');

    expect(correlated.status).toBe(202);
    expect(standalone.status).toBe(202);
    expect(f.configuration.headers.get('cache-control')).toBe('no-store');
    expect(f.config.assets).toEqual([{ id: asset, path: '/_astro/synthetic.js' }]);
    expect(errors).toHaveLength(2);
    expect(errors[0].parentSpanContext?.spanId).toBe(request.spanContext().spanId);
    expect(errors[0].spanContext().traceId).toBe(request.spanContext().traceId);
    expect(errors[0].attributes).toEqual({
      operation: 'frontend.error',
      outcome: 'client_error',
      'frontend.application': 'web-site',
      'frontend.error.code': 'request_failed',
      'frontend.error.kind': 'TypeError',
      'frontend.screen': 'ui',
      'frontend.release': expect.stringMatching(/^[a-f0-9]{64}$/),
      'code.asset': asset,
      'code.line': 2,
      'code.column': 11,
    });
    expect(errors[1].parentSpanContext).toBeUndefined();
    expect(errors[1].attributes['frontend.release']).toBe('unknown');
    expect(errors.every((span) => span.events.length === 0 && span.links.length === 0)).toBe(true);
    expect(JSON.stringify(errors.map((span) => span.attributes)) + f.lines.join('')).not.toContain(marker);
    expect(request.spanContext().traceId).not.toBe('f'.repeat(32));
    const rootApi = await fetch(f.url + '/api');

    expect(rootApi.headers.has('x-telemetry-context')).toBe(true);
  });

  it.each([
    { origin: 'https://untrusted.example.test' },
    { 'content-type': 'text/plain' },
    { 'x-browser-telemetry': '' },
    { 'x-browser-telemetry': 'synthetic' },
    { 'x-browser-telemetry': 'synthetic.' },
    { 'x-browser-telemetry': `synthetic.${Buffer.alloc(32).toString('base64url')}` },
    { 'x-browser-telemetry': 'x'.repeat(1025) },
    { 'x-browser-telemetry': signed('not-json') },
    { 'x-browser-telemetry': signed({ purpose: 'invalid', expires: Date.now() + 60000 }) },
    { 'x-browser-telemetry': signed({ purpose: 'correlate', expires: Date.now() + 60000 }) },
    { 'x-browser-telemetry': signed({ purpose: 'report', expires: 1 }) },
  ])('rejects invalid intake authorization %j', async (headers) => {
    const f = await fixture();
    const response = await f.send(report, headers);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'telemetry_denied' });
    expect(f.spans.getFinishedSpans().some((span) => span.name === 'frontend.error')).toBe(false);
  });

  it.each([
    { ...report, application: 'web-app' },
    { ...report, kind: marker },
    { ...report, screen: marker },
    { ...report, message: marker },
    { ...report, stack: marker },
    { ...report, release: marker },
    { ...report, location: { asset: 'b'.repeat(64), line: 1, column: 1 } },
    { ...report, location: { asset, line: 3, column: 1 } },
    { ...report, location: { asset, line: 1, column: 102 } },
    { ...report, location: { asset, line: 0, column: 1 } },
    'null',
    '{',
  ])('rejects arbitrary fields, values, and code references %j', async (payload) => {
    const f = await fixture();
    const response = await f.send(payload);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'telemetry_invalid' });
    expect(f.lines.join('')).not.toContain(marker);
  });

  it('bounds payloads, disables compression, expires tokens, and resets its global request budget', async () => {
    const f = await fixture();
    const oversized = await f.send({ ...report, private: marker.repeat(200) });
    const compressed = await f.send('{}', { 'content-encoding': 'gzip' });

    expect(oversized.status).toBe(400);
    expect(compressed.status).toBe(400);
    for (let i = 0; i < 118; i++) {
      await fetch(f.url + '/telemetry/config');
    }
    const limited = await f.send();

    expect(limited.status).toBe(429);
    f.advance(60000);
    const reset = await f.send();

    expect(reset.status).toBe(202);
    f.advance(300000);
    const expired = await f.send();

    expect(expired.status).toBe(403);
    const refreshed = await fetch(f.url + '/telemetry/config');

    expect(refreshed.status).toBe(200);
  });

  it('supports the real clock and ignores signed tokens without a correlation context', async () => {
    const f = await fixture(false);
    const response = await f.send({
      ...report,
      correlation: signed({ purpose: 'correlate', expires: Date.now() + 60000 }),
    });

    expect(response.status).toBe(202);
    expect(
      f.spans.getFinishedSpans().find((span) => span.name === 'frontend.error')?.parentSpanContext,
    ).toBeUndefined();
  });
});
