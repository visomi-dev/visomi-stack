import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { initializeObservability } from '@visomi-stack/web-backend-shared';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../../..');
const output = join(root, 'dist/apps/web/api');

describe('API process and compiled boundaries', () => {
  it('imports the deployed CommonJS app under an ESM parent without listeners or telemetry initialization', async () => {
    await mkdir(join(root, 'tmp'), { recursive: true });
    const directory = await mkdtemp(join(root, 'tmp/api-boundary-'));

    try {
      await cp(output, join(directory, 'api'), { recursive: true });
      await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
      const script = `
        const net = require('node:net');
        let listens = 0;
        let connections = 0;
        let providers = 0;
        let intervals = 0;
        net.Server.prototype.listen = () => { listens++; throw new Error('unexpected listener'); };
        net.Socket.prototype.connect = () => { connections++; throw new Error('unexpected connection'); };
        for (const [name, key] of [['@opentelemetry/sdk-trace', 'TracerProvider'], ['@opentelemetry/sdk-metrics', 'MeterProvider']]) {
          const path = require.resolve(name);
          const loaded = require(name);
          require.cache[path].exports = new Proxy(loaded, {
            get(target, property) {
              const value = target[property];
              return property === key ? new Proxy(value, { construct() { providers++; throw new Error('unexpected SDK'); } }) : value;
            }
          });
        }
        global.setInterval = () => { intervals++; throw new Error('unexpected loop'); };
        const app = require(${JSON.stringify(join(directory, 'api'))});
        app.createApp();
        console.log(JSON.stringify({ listens, connections, providers, intervals, exports: Object.keys(app) }));
      `;
      const result = await execute(process.execPath, ['-e', script], { cwd: root, timeout: 5000 });

      expect(JSON.parse(result.stdout)).toEqual({
        listens: 0,
        connections: 0,
        providers: 0,
        intervals: 0,
        exports: ['createApp'],
      });
      const metadataText = await readFile(join(directory, 'api/package.json'), 'utf8');
      const metadata = JSON.parse(metadataText);

      expect(metadata.type).toBe('commonjs');
      expect(metadata.main).toBe('./app.js');
      expect(metadata.exports).toEqual({ '.': './app.js', './app': './app.js' });
      expect(metadata.dependencies.pino).toBeDefined();
      expect(metadata.dependencies['@opentelemetry/sdk-trace']).toBeDefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['SIGTERM', 'SIGINT'] as const)('serves the standalone build and drains on %s', async (signal) => {
    const probe = createServer();

    await new Promise<void>((resolveReady) => probe.listen(0, '127.0.0.1', resolveReady));
    const address = probe.address();

    if (!address || typeof address === 'string') {
      throw new Error('Missing test port');
    }

    await new Promise<void>((resolveClosed) => probe.close(() => resolveClosed()));
    const child = spawn(process.execPath, [join(output, 'main.js')], {
      cwd: root,
      env: { HOST: '127.0.0.1', PORT: String(address.port), NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exit = once(child, 'exit');
    let logs = '';
    let errors = '';

    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });

    try {
      await new Promise<void>((resolveReady, reject) => {
        const timeout = setTimeout(() => reject(new Error('Standalone startup timed out')), 5000);

        child.once('error', reject);
        child.once('exit', () => {
          clearTimeout(timeout);
          reject(new Error('Standalone exited before readiness'));
        });
        child.stdout.on('data', (chunk) => {
          logs += chunk;

          if (logs.includes('"event":"runtime.started"')) {
            clearTimeout(timeout);
            resolveReady();
          }
        });
      });
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      const body = await response.json();

      expect(body).toEqual({ message: 'Hello API' });
      expect(response.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/);
      child.kill(signal);
      const [code] = await exit;

      expect(code).toBe(0);
      expect(errors).toBe('');
      const events = logs
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).event);

      expect(events).toEqual(['runtime.started', 'http.request', 'runtime.stopped']);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exit;
      }
    }
  });

  it('restores job correlation in another process from technical fields only', async () => {
    const telemetry = initializeObservability({
      service: 'web-api',
      version: '0.0.1',
      environment: 'test',
      destination: { write: () => undefined },
    });

    try {
      const request = telemetry.beginHttp();
      const carrier = request.run(() => telemetry.captureJobContext());
      const script = `
        const { initializeObservability } = require(${JSON.stringify(join(root, 'libs/web/backend/shared/src/index.ts'))});
        const telemetry = initializeObservability({ service: 'worker', version: '0.0.1', destination: { write() {} } });
        const carrier = JSON.parse(process.argv[1]);
        telemetry.runJob(carrier, async () => telemetry.correlation()).then(async context => {
          console.log(JSON.stringify(context));
          await telemetry.shutdown();
        });
      `;
      const result = await execute(
        process.execPath,
        [
          '--import',
          'tsx',
          '-e',
          script,
          JSON.stringify({
            ...carrier,
            baggage: 'SYNTHETIC_CUSTOMER_MARKER',
            payload: 'SYNTHETIC_CUSTOMER_MARKER',
          }),
        ],
        { cwd: root, timeout: 5000 },
      );
      const restored = JSON.parse(result.stdout);

      expect(restored.requestId).toBe(carrier?.requestId);
      expect(restored.traceId).toBe(carrier?.traceId);
      expect(restored.spanId).not.toBe(carrier?.spanId);
      expect(Object.keys(restored).sort()).toEqual(['requestId', 'spanId', 'traceId']);
      request.finish('success', 200);
    } finally {
      await telemetry.shutdown();
    }
  });
});
