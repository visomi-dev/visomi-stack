import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const execute = promisify(execFile);

// Always creates an owned cluster; developer DATABASE_URL is deliberately never consulted.
export async function testPostgres(manifest?: string) {
  const temporaryRoot = manifest ? dirname(manifest) : tmpdir();
  const directory = await mkdtemp(join(temporaryRoot, 'visomi-auth-test-'));
  const binary = process.env.PG_BIN ?? '/usr/lib/postgresql/17/bin';

  await writeFile(join(directory, 'test-owner'), 'visomi-stack-isolated-postgres');

  if (manifest) {
    await writeFile(manifest, JSON.stringify({ directory, binary }));
  }

  const probe = createServer();

  await new Promise<void>((ready) => probe.listen(0, '127.0.0.1', ready));
  const address = probe.address();

  if (!address || typeof address === 'string') {
    throw new Error('test_postgres_port_unavailable');
  }

  await new Promise<void>((closed) => probe.close(() => closed()));
  let started = false;

  try {
    await execute(join(binary, 'initdb'), [
      '-D',
      join(directory, 'data'),
      '-A',
      'trust',
      '-U',
      'visomi_test',
      '--no-locale',
    ]);
    // Repository paths can exceed the Unix socket limit; tests connect over loopback TCP.
    await execute(join(binary, 'pg_ctl'), [
      '-D',
      join(directory, 'data'),
      '-l',
      join(directory, 'postgres.log'),
      '-w',
      '-t',
      '10',
      '-o',
      `-h 127.0.0.1 -p ${address.port} -c unix_socket_directories='' -F`,
      'start',
    ]);
    started = true;
    const base = `postgresql://visomi_test@127.0.0.1:${address.port}`;
    const admin = new Pool({ connectionString: `${base}/postgres` });

    try {
      await admin.query('CREATE DATABASE visomi_auth_test');
    } finally {
      await admin.end();
    }

    const url = `${base}/visomi_auth_test`;
    const pool = new Pool({ connectionString: url });
    const db = drizzle({ client: pool, logger: false });

    try {
      await migrate(db, {
        migrationsFolder: resolve(__dirname, '../../libs/backend/shared/src/lib/database/migrations'),
      });
    } finally {
      await pool.end();
    }

    let stopping: Promise<void> | undefined;
    const stop = () => (stopping ??= stopTestPostgres(directory, binary));

    return { url, directory, stop };
  } catch {
    if (started) {
      await execute(join(binary, 'pg_ctl'), ['-D', join(directory, 'data'), '-w', '-m', 'immediate', 'stop']);
    }

    await rm(directory, { recursive: true, force: true });

    throw new Error('isolated_postgres_setup_failed');
  }
}

export async function stopTestPostgres(directory: string, binary: string) {
  if (!basename(directory).startsWith('visomi-auth-test-')) {
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

  const pidFile = join(directory, 'data/postmaster.pid');
  const running = async () => {
    try {
      await access(pidFile);

      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }

      throw error;
    }
  };
  const active = await running();

  if (active) {
    try {
      await execute(join(binary, 'pg_ctl'), [
        '-D',
        join(directory, 'data'),
        '-w',
        '-t',
        '10',
        '-m',
        'immediate',
        'stop',
      ]);
    } catch {
      const stillRunning = await running();

      if (stillRunning) {
        throw new Error('isolated_postgres_cleanup_failed');
      }
    }
  }

  await rm(directory, { recursive: true, force: true });
}
