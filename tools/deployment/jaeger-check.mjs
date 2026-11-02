import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { bcrypt } from 'hash-wasm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const engine = process.env.CONTAINER_ENGINE || 'docker';
const image = 'jaegertracing/jaeger:2.22.0@sha256:4d9387a02389204ef9a256cf291a36cfbae91983010e403b4d300202d07eff2a';
const name = `visomi-jaeger-check-${randomUUID()}`;
const volume = `${name}-data`;
const configuration = await readFile(new URL('../../.railway/jaeger.yaml', import.meta.url), 'utf8');
const marker = 'SYNTHETIC_PRIVATE_JAEGER_71d3';
const password = 'synthetic-receiver-password';
const authorization = `Basic ${Buffer.from(`gateway:${password}`).toString('base64')}`;
const passwordHash = await bcrypt({
  password,
  salt: randomBytes(16),
  costFactor: 12,
  outputType: 'encoded',
});
const htpasswd = `gateway:${passwordHash}`;
const container = (...args) =>
  execFileSync(engine, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let child;
let volumeCreated = false;
let containerCreated = false;

async function eventually(work) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const result = await work();

      if (result) {
        return result;
      }
    } catch {
      // Container readiness and storage visibility are asynchronous.
    }

    await delay(100);
  }

  throw new Error('jaeger_check_timeout');
}

async function startGateway(endpoint) {
  const reservation = createServer();

  reservation.listen(0, '127.0.0.1');

  await once(reservation, 'listening');

  const port = reservation.address().port;

  await new Promise((resolve) => reservation.close(resolve));

  const logs = [];

  child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    await import('./dist/apps/web/gateway/main.js');
    process.on('message', async () => {
      const runtime = globalThis[Symbol.for('visomi-stack.observability.v1')].runtime;
      await runtime.runJob(undefined, async () => undefined);
      try { await runtime.runJob(undefined, async () => { throw new Error('${marker}'); }); } catch {}
      process.disconnect();
      process.kill(process.pid, 'SIGTERM');
    });
  `,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        NODE_ENV: 'test',
        DATABASE_URL: '',
        API_APP_PATH: '',
        SITE_APP_PATH: '',
        APPLICATION_APP_PATH: '',
        VISOMI_OTLP_TRACING: 'true',
        VISOMI_BROWSER_TELEMETRY: 'true',
        VISOMI_BROWSER_PERFORMANCE: 'true',
        BROWSER_TELEMETRY_ORIGIN: `http://127.0.0.1:${port}`,
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
        OTEL_EXPORTER_OTLP_HEADERS: `authorization=${encodeURIComponent(authorization)}`,
        OTEL_RESOURCE_ATTRIBUTES: `customer=${marker}`,
        OTEL_SERVICE_NAME: marker,
        OTEL_METRICS_EXPORTER: 'none',
        OTEL_LOGS_EXPORTER: 'none',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let output = '';

  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.resume();
  const origin = `http://127.0.0.1:${port}`;

  await eventually(async () => {
    const response = await fetch(`${origin}/api/`);

    return response.ok;
  });

  return {
    origin,
    async stop(requireFlush = true) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(10000) });

      child.send('finish');
      const [code] = await exited;

      assert.ok(requireFlush ? code === 0 : [0, 1].includes(code), 'Gateway must finish its shutdown path');
      assert.ok(!output.includes(marker), 'Operational logs must exclude synthetic private data');
      for (const line of output.trim().split('\n')) {
        const entry = JSON.parse(line);

        if (entry.traceId) {
          logs.push(entry);
        }
      }
      child = undefined;

      return logs;
    },
  };
}

try {
  assert.match(configuration, /spans: 48h/);
  container('volume', 'create', volume);
  volumeCreated = true;
  container(
    'run',
    '--detach',
    '--name',
    name,
    '--user',
    '0',
    '--publish',
    '127.0.0.1::4318',
    '--publish',
    '127.0.0.1::16686',
    '--volume',
    `${volume}:/badger`,
    '--env',
    `JAEGER_CONFIG=${configuration}`,
    '--env',
    `JAEGER_HTPASSWD=${htpasswd}`,
    image,
    '--config',
    'env:JAEGER_CONFIG',
  );
  containerCreated = true;
  const receiver = `http://${container('port', name, '4318/tcp')}`;
  let query = `http://${container('port', name, '16686/tcp')}`;

  await eventually(async () => {
    const response = await fetch(`${query}/api/v3/services`);

    return response.ok;
  });

  const unauthorized = await fetch(`${receiver}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

  assert.equal(unauthorized.status, 401, 'The receiver must reject unauthenticated exports');
  const wrongPassword = await fetch(`${receiver}/v1/traces`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from('gateway:synthetic-incorrect-password').toString('base64')}`,
    },
    body: '{}',
  });

  assert.equal(wrongPassword.status, 401, 'The receiver must reject an incorrect password');
  const gateway = await startGateway(receiver);

  for (const [path, status] of [
    [`/missing/${marker}?secret=${marker}`, 404],
    ['/api/auth/session', 503],
  ]) {
    const response = await fetch(`${gateway.origin}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${marker}`,
        cookie: `session=${marker}`,
        'user-agent': marker,
        'x-forwarded-for': '192.0.2.100',
        'x-request-id': marker,
        traceparent: `00-${'f'.repeat(32)}-${'f'.repeat(16)}-01`,
        baggage: `private=${marker}`,
      },
      body: JSON.stringify({ private: marker }),
    });

    assert.equal(response.status, status);

    await response.arrayBuffer();
  }
  const configurationResponse = await fetch(`${gateway.origin}/telemetry/config`);
  const browserConfiguration = await configurationResponse.json();
  const failedRequest = await fetch(`${gateway.origin}/api/auth/session`);
  const correlation = failedRequest.headers.get('x-telemetry-context');

  assert.ok(correlation, 'The gateway must issue its own signed correlation context');
  for (const [application, prefix] of [
    ['web-site', '/_astro/'],
    ['web-app', '/app/'],
  ]) {
    const asset = browserConfiguration.assets.find((entry) => entry.path.startsWith(prefix));

    assert.ok(asset);
    const browserReport = await fetch(`${gateway.origin}/telemetry/errors`, {
      method: 'POST',
      headers: {
        origin: gateway.origin,
        'content-type': 'application/json',
        'x-browser-telemetry': browserConfiguration.token,
        cookie: marker,
        authorization: `Bearer ${marker}`,
      },
      body: JSON.stringify({
        application,
        code: 'request_failed',
        kind: 'unknown',
        screen: 'home',
        location: { asset: asset.id, line: 1, column: 1 },
        correlation,
      }),
    });

    assert.equal(browserReport.status, 202);
    const performanceReport = await fetch(`${gateway.origin}/telemetry/performance`, {
      method: 'POST',
      headers: {
        origin: gateway.origin,
        'content-type': 'application/json',
        'x-browser-telemetry': browserConfiguration.token,
        cookie: marker,
        'user-agent': marker,
        traceparent: `00-${'f'.repeat(32)}-${'f'.repeat(16)}-01`,
      },
      body: JSON.stringify({
        application,
        screen: 'home',
        measurements: [
          { name: 'lcp', value: 120.5 },
          ...(application === 'web-app' ? [{ name: 'route_completed', value: 25.5 }] : []),
        ],
      }),
    });

    assert.equal(performanceReport.status, 202);
  }
  const logs = await gateway.stop();
  const verifiedApplications = new Set();
  const performanceApplications = new Set();
  const readTrace = async (id) => {
    const response = await fetch(`${query}/api/v3/traces/${id}?raw_traces=true`);
    const body = await response.text();
    const records = body
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    return records.flatMap((record) => record.result?.resourceSpans ?? [])[0];
  };

  for (const log of logs) {
    const trace = await eventually(() => readTrace(log.traceId));
    const serialized = JSON.stringify(trace);

    assert.ok(!serialized.includes(marker));
    assert.ok(!serialized.includes('f'.repeat(32)));
    assert.deepEqual(trace.resource.attributes.map((attribute) => attribute.key).sort(), [
      'deployment.environment.name',
      'service.name',
      'service.version',
    ]);
    for (const scope of trace.scopeSpans) {
      assert.equal(scope.scope.name, 'visomi-stack.operational');
      for (const span of scope.spans) {
        assert.ok(['http.request', 'job.execute', 'frontend.error', 'frontend.performance'].includes(span.name));
        assert.equal(span.events?.length ?? 0, 0, 'Application spans must not carry events or exceptions');
        assert.equal(span.links?.length ?? 0, 0);

        if (span.name === 'frontend.error') {
          verifiedApplications.add(
            span.attributes.find((attribute) => attribute.key === 'frontend.application').value.stringValue,
          );
          assert.ok(span.parentSpanId, 'Browser API errors must reference a verified gateway span');
        } else {
          assert.ok(!span.parentSpanId, 'Synthetic operations must generate fresh root traces');
        }

        if (span.name === 'frontend.performance') {
          performanceApplications.add(
            span.attributes.find((attribute) => attribute.key === 'frontend.application').value.stringValue,
          );
          assert.equal(
            span.attributes.find((attribute) => attribute.key === 'frontend.performance.lcp').value.doubleValue,
            120.5,
          );

          if (
            span.attributes.find((attribute) => attribute.key === 'frontend.application').value.stringValue ===
            'web-app'
          ) {
            assert.equal(
              span.attributes.find((attribute) => attribute.key === 'frontend.performance.route_completed').value
                .doubleValue,
              25.5,
            );
          }
        }

        assert.ok(!span.status?.message);
        const keys = span.attributes.map((attribute) => attribute.key);

        assert.ok(
          // Badger's Jaeger model roundtrip uses the legacy HTTP status attribute name.
          keys.every((key) =>
            (span.name === 'frontend.performance'
              ? [
                  'operation',
                  'outcome',
                  'frontend.application',
                  'frontend.screen',
                  'frontend.performance.lcp',
                  'frontend.performance.route_completed',
                ]
              : span.name === 'frontend.error'
                ? [
                    'operation',
                    'outcome',
                    'frontend.application',
                    'frontend.error.code',
                    'frontend.error.kind',
                    'frontend.screen',
                    'frontend.release',
                    'code.asset',
                    'code.line',
                    'code.column',
                  ]
                : ['operation', 'outcome', 'http.response.status_code', 'http.status_code']
            ).includes(key),
          ),
          `Span attributes must remain allowlisted: ${keys.join(', ')}`,
        );
      }
    }
  }
  assert.deepEqual([...verifiedApplications].sort(), ['web-app', 'web-site']);
  assert.deepEqual([...performanceApplications].sort(), ['web-app', 'web-site']);
  assert.ok(logs.some((log) => log.event === 'job.execute' && log.outcome === 'job_failed'));
  container('stop', '--time', '10', name);
  const unavailable = await startGateway(receiver);

  const availableResponse = await fetch(`${unavailable.origin}/api/`);

  assert.equal(availableResponse.status, 200);

  await unavailable.stop(false);

  container('start', name);

  // Docker may assign a new ephemeral host port when the same container starts again.
  query = `http://${container('port', name, '16686/tcp')}`;

  await eventually(() => readTrace(logs[0].traceId));

  console.log(
    'Jaeger authentication, safe HTTP/job/browser traces, verified correlation, shutdown flush, receiver outage, persistence and 48h TTL configuration verified.',
  );
} finally {
  child?.kill('SIGKILL');

  try {
    if (containerCreated) {
      container('rm', '--force', name);
    }
  } finally {
    if (volumeCreated) {
      container('volume', 'rm', volume);
    }
  }
}
