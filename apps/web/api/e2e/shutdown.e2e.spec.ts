import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

import { Pool } from 'pg';

import { expect, test } from './fixtures/http';

async function startStandalone(directory: string, runDirectory: string) {
  const root = resolve(__dirname, '../../../..');
  const text = await readFile(join(runDirectory, 'database.json'), 'utf8');
  const databaseUrl = new URL(JSON.parse(text).url);

  databaseUrl.searchParams.set('application_name', 'visomi_e2e_shutdown');
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
    [
      '--require',
      join(root, 'apps/web/api/e2e/support/telemetry-preload.cjs'),
      join(root, 'dist/apps/web/api/main.js'),
    ],
    {
      cwd: root,
      env: {
        HOST: '127.0.0.1',
        PORT: String(address.port),
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl.toString(),
        AUTH_ORIGIN: 'http://127.0.0.1:3307',
        AUTH_RP_ID: '127.0.0.1',
        SESSION_SECRET: 'synthetic-e2e-only-session-secret-32-bytes',
        VISOMI_E2E_TELEMETRY_DIR: directory,
        VISOMI_E2E_HOLD_SPANS: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  return { child, databaseUrl: databaseUrl.toString(), origin: `http://127.0.0.1:${address.port}` };
}

async function closeStandalone(child: ReturnType<typeof spawn>, exited: Promise<unknown>) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

test('the compiled executable delivers pending telemetry within its shutdown limits', async ({
  request,
  telemetry: telemetryFiles,
}, testInfo) => {
  const directory = testInfo.outputPath('telemetry');
  const { child, origin, databaseUrl } = await startStandalone(directory, telemetryFiles.directory);
  const probeUrl = new URL(databaseUrl);

  probeUrl.searchParams.set('application_name', 'visomi_e2e_probe');
  const pool = new Pool({ connectionString: probeUrl.toString() });
  const exited = once(child, 'exit');
  let errors = '';

  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });

  try {
    await expect
      .poll(async () => {
        const telemetry = await telemetryFiles.read(directory);

        return telemetry.logs.some((log) => log.event === 'runtime.started');
      })
      .toBe(true);
    const active = await pool.query(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = 'visomi_e2e_shutdown'",
    );

    expect(active.rows[0].count).toBe(1);
    const response = await request.get(`${origin}/`);
    const id = response.headers()['x-request-id'];

    expect(response.status()).toBe(200);
    await expect
      .poll(async () => {
        const telemetry = await telemetryFiles.read(directory);

        return telemetry.pending.some((entry) => entry.file === 'spans.jsonl');
      })
      .toBe(true);
    const beforeShutdown = await telemetryFiles.read(directory);

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
    const telemetry = await telemetryFiles.read(directory);
    const completion = telemetry.logs.filter((log) => log.requestId === id);

    await expect
      .poll(async () => {
        const closed = await pool.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = 'visomi_e2e_shutdown'",
        );

        return closed.rows[0].count;
      })
      .toBe(0);
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
    await pool.end();
  }
});
