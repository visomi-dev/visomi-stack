import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { createTestCompose, runTestCompose } from './compose';
import type { TestCompose } from './compose';

// Every resource has its own Compose project/volume; developer DATABASE_URL is never consulted.
export async function testPostgres(manifest?: string, app: TestCompose['app'] = 'web-api', signal?: AbortSignal) {
  const temporaryRoot = manifest ? dirname(manifest) : tmpdir();
  const directory = await mkdtemp(join(temporaryRoot, 'visomi-auth-test-'));
  let compose: TestCompose | undefined;

  await writeFile(join(directory, 'test-owner'), 'visomi-stack-isolated-postgres');

  await writeFile(join(directory, 'compose.env'), '');

  try {
    const created = await createTestCompose(directory, temporaryRoot, app);

    compose = created;

    if (manifest) {
      await writeFile(manifest, JSON.stringify({ directory, compose }));
    }

    await runTestCompose(compose, ['up', '-d', 'postgres'], signal);

    const { stdout } = await runTestCompose(compose, ['port', 'postgres', '5432'], signal);
    // Docker reports the binding; podman-compose reports only the published port.
    const match = /^(?:127\.0\.0\.1:)?(\d+)$/.exec(stdout.trim());

    if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) {
      throw new Error('test_postgres_port_unavailable');
    }

    const url = `postgresql://visomi_test:synthetic-test-password@127.0.0.1:${match[1]}/visomi_auth_test`;
    const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 1000 });
    const db = drizzle({ client: pool, logger: false });

    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await pool.query('SELECT 1');

          break;
        } catch {
          if (attempt === 99) {
            throw new Error('test_postgres_startup_timeout');
          }

          await delay(100, undefined, { signal });
        }
      }

      await migrate(db, {
        migrationsFolder: resolve(__dirname, '../../../../../libs/backend/shared/src/lib/database/migrations'),
      });
    } finally {
      await pool.end();
    }

    let stopping: Promise<void> | undefined;
    const owner = compose;
    const stop = () => (stopping ??= stopTestPostgres(directory, owner));

    return { url, directory, compose, stop };
  } catch {
    if (compose) {
      await stopTestPostgres(directory, compose);
    } else {
      await rm(directory, { recursive: true, force: true });
    }

    throw new Error('isolated_postgres_setup_failed');
  }
}

export async function stopTestPostgres(directory: string, compose: TestCompose) {
  if (!basename(directory).startsWith('visomi-auth-test-') || compose.directory !== directory) {
    throw new Error('isolated_postgres_owner_invalid');
  }

  try {
    const marker = await readFile(join(directory, 'test-owner'), 'utf8');

    if (marker !== 'visomi-stack-isolated-postgres') {
      throw new Error('isolated_postgres_owner_invalid');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }

  try {
    await runTestCompose(compose, ['down', '--volumes', '--remove-orphans']);
  } catch {
    // Keep the manifest/marker when cleanup fails so teardown can retry safely.
    throw new Error('isolated_postgres_cleanup_failed');
  }

  await rm(directory, { recursive: true, force: true });
}
