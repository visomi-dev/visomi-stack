import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { testPostgres } from '../tests/support/postgres';

async function serve() {
  const directory = process.env.VISOMI_E2E_TELEMETRY_DIR!;
  const postgres = await testPostgres(join(directory, 'postgres.json'));

  await writeFile(join(directory, 'database.json'), JSON.stringify({ url: postgres.url }));
  const child = spawn('pnpm', ['nx', 'serve', 'web-api'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: postgres.url,
      AUTH_ORIGIN: 'http://127.0.0.1:3307',
      AUTH_RP_ID: '127.0.0.1',
      SESSION_SECRET: 'synthetic-e2e-only-session-secret-32-bytes',
    },
  });
  let stopping: Promise<void> | undefined;
  const stop = (code: number) =>
    (stopping ??= (async () => {
      child.kill('SIGTERM');
      await postgres.stop();
      process.exitCode = code;
    })());

  process.once('SIGTERM', () => void stop(0));
  process.once('SIGINT', () => void stop(0));
  child.once('exit', (code) => void stop(code ?? 1));
  child.once('error', () => void stop(1));
}

void serve().catch(() => {
  process.stderr.write('isolated_api_test_startup_failed\n');
  process.exitCode = 1;
});
