import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import type { KeyProof, TotpFixture } from './restore-crypto.ts';

export function assertRestoreIsolation(options: { memory?: boolean }, env: NodeJS.ProcessEnv): void {
  if (env.DOCKER_HOST || env.DOCKER_CONTEXT || env.CONTAINER_HOST || env.CONTAINER_CONNECTION)
    throw new Error(
      'Restore proof requires the default local container engine; remote/context overrides are not accepted.',
    );
  if (options.memory || env.SMOKE_DATABASE_URL || env.SMOKE_REDIS_URL)
    throw new Error(
      'Restore proof requires task-owned PostgreSQL and Redis containers; memory and SMOKE_* overrides are not accepted.',
    );
}

/** pg_dump adds random psql restriction keys in newer PostgreSQL minor releases. */
export function dumpFingerprint(dump: string): string {
  return createHash('sha256')
    .update(dump.replace(/^\\(?:un)?restrict .*\r?\n/gm, ''))
    .digest('hex');
}

/** Only called with the container created by this smoke invocation. No ambient DB credentials. */
export function restoreOwnedPostgres(
  engine: string,
  container: string,
  execute: typeof spawnSync = spawnSync,
  totpFixture?: TotpFixture,
): {
  schema: string;
  data: string;
  totpKeyContinuity?: KeyProof & { scope: 'synthetic-totp-v1-record'; keyVersion: 1 };
} {
  if (!['docker', 'podman'].includes(engine) || !/^visomi-template-[a-f0-9]{12}-postgres$/.test(container))
    throw new Error('Restore requires a task-owned smoke container.');
  const exec = (args: string[], input?: string) => {
    const result = execute(engine, ['exec', ...(input ? ['-i'] : []), container, ...args], {
      input,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 128 * 1024 * 1024,
    });

    if (result.status !== 0)
      throw new Error('Disposable PostgreSQL restore command failed; raw database output suppressed.');

    return result.stdout;
  };
  const sql = (database: string, input: string) =>
    exec(
      [
        'psql',
        '-X',
        '-U',
        'postgres',
        '-d',
        database,
        '-v',
        'ON_ERROR_STOP=1',
        '--quiet',
        '--tuples-only',
        '--no-align',
      ],
      input,
    );

  if (totpFixture) {
    if (!/^1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(totpFixture.encryptedSecret))
      throw new Error('Invalid encrypted TOTP fixture format.');
    sql(
      'template_smoke',
      `CREATE SCHEMA restore_fixture;
CREATE TABLE restore_fixture.totp (id integer PRIMARY KEY, key_version integer NOT NULL, encrypted_secret text NOT NULL);
INSERT INTO restore_fixture.totp VALUES (1, 1, '${totpFixture.encryptedSecret}');`,
    );
  }
  const fingerprint = (database: string, kind: '--schema-only' | '--data-only') =>
    dumpFingerprint(
      exec(['pg_dump', '-U', 'postgres', '-d', database, '--no-owner', '--no-privileges', '--inserts', kind]),
    );
  const before = {
    schema: fingerprint('template_smoke', '--schema-only'),
    data: fingerprint('template_smoke', '--data-only'),
  };

  try {
    // A custom-format dump is kept inside the disposable container, mode 0600.
    exec([
      'sh',
      '-c',
      'umask 077; pg_dump -U postgres -d template_smoke --format=custom --file=/tmp/restore-proof.dump',
    ]);
    // No --if-exists or drop: an existing destination is an error, never overwritten.
    exec(['createdb', '-U', 'postgres', 'template_restore']);
    exec([
      'pg_restore',
      '-U',
      'postgres',
      '-d',
      'template_restore',
      '--exit-on-error',
      '--single-transaction',
      '/tmp/restore-proof.dump',
    ]);
    const after = {
      schema: fingerprint('template_restore', '--schema-only'),
      data: fingerprint('template_restore', '--data-only'),
    };

    if (before.schema !== after.schema || before.data !== after.data)
      throw new Error('Restored schema or data fingerprint differs from the source.');

    if (!totpFixture) return after;
    const restored = sql(
      'template_restore',
      'SELECT encrypted_secret FROM restore_fixture.totp WHERE id = 1 AND key_version = 1;',
    ).trim();
    const proof = totpFixture.verify(restored);

    return { ...after, totpKeyContinuity: { scope: 'synthetic-totp-v1-record', keyVersion: 1, ...proof } };
  } finally {
    exec(['rm', '-f', '/tmp/restore-proof.dump']);
  }
}
