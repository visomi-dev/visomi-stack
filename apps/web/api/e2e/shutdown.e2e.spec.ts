import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { readTelemetry } from './telemetry';

async function startStandalone(directory: string) {
  const root = resolve(__dirname, '../../../..');
  const probe = createServer();

  await mkdir(directory, { recursive: true });
  await new Promise<void>((resolveReady) => probe.listen(0, '127.0.0.1', resolveReady));
  const address = probe.address();

  if (!address || typeof address === 'string') {
    throw new Error('Missing test port');
  }

  await new Promise<void>((resolveClosed) => probe.close(() => resolveClosed()));
  const child = spawn(
    process.execPath,
    ['--require', join(__dirname, 'telemetry-preload.cjs'), join(root, 'dist/apps/web/api/main.js')],
    {
      cwd: root,
      env: {
        HOST: '127.0.0.1',
        PORT: String(address.port),
        NODE_ENV: 'test',
        VISOMI_E2E_TELEMETRY_DIR: directory,
        VISOMI_E2E_HOLD_SPANS: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  return { child, origin: `http://127.0.0.1:${address.port}` };
}

async function closeStandalone(child: ReturnType<typeof spawn>, exited: Promise<unknown>) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

test('the compiled executable delivers pending telemetry within its shutdown limits', async ({ request }, testInfo) => {
  const directory = testInfo.outputPath('telemetry');
  const { child, origin } = await startStandalone(directory);
  const exited = once(child, 'exit');
  let errors = '';

  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });

  try {
    await expect
      .poll(async () => {
        const telemetry = await readTelemetry(directory);

        return telemetry.logs.some((log) => log.event === 'runtime.started');
      })
      .toBe(true);
    const response = await request.get(`${origin}/`);
    const id = response.headers()['x-request-id'];

    expect(response.status()).toBe(200);
    await expect
      .poll(async () => {
        const telemetry = await readTelemetry(directory);

        return telemetry.pending.some((entry) => entry.file === 'spans.jsonl');
      })
      .toBe(true);
    const beforeShutdown = await readTelemetry(directory);

    expect(beforeShutdown.spans).toHaveLength(0);
    const started = performance.now();

    child.kill('SIGTERM');
    const exitResult = await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('Shutdown exceeded five seconds')), 5000);

        void exited.then(() => clearTimeout(deadline));
      }),
    ]);
    const telemetry = await readTelemetry(directory);
    const completion = telemetry.logs.filter((log) => log.requestId === id);

    expect(exitResult[0]).toBe(0);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(errors).toBe('');
    expect(completion).toHaveLength(1);
    expect(telemetry.logs.map((log) => log.event)).toEqual(['runtime.started', 'http.request', 'runtime.stopped']);
    expect(telemetry.spans).toHaveLength(1);
    expect(telemetry.metrics.length).toBeGreaterThan(0);
    expect((telemetry.spans[0].context as { spanId: string }).spanId).toBe(completion[0].spanId);
  } finally {
    await closeStandalone(child, exited);
  }
});
