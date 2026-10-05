import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertRestoreIsolation, dumpFingerprint, restoreOwnedPostgres } from './restore.ts';
import { createProtectedTotpFixture } from './restore-crypto.ts';

test('restore rejects memory and external services before doing work', () => {
  assert.throws(() => assertRestoreIsolation({ memory: true }, {}));
  assert.throws(() => assertRestoreIsolation({}, { SMOKE_DATABASE_URL: 'postgres://disposable' }));
  assert.throws(() => assertRestoreIsolation({}, { SMOKE_REDIS_URL: 'redis://disposable' }));
  assert.throws(() => assertRestoreIsolation({}, { DOCKER_HOST: 'tcp://remote:2375' }));
  assert.doesNotThrow(() => assertRestoreIsolation({}, { DATABASE_URL: 'postgres://production' }));
  assert.throws(() => restoreOwnedPostgres('docker', 'production-postgres'));
});

test('fingerprints ignore pg_dump restriction nonces and detect schema/data changes', () => {
  assert.equal(
    dumpFingerprint('\\restrict one\nCREATE TABLE a();\n\\unrestrict one\n'),
    dumpFingerprint('\\restrict two\nCREATE TABLE a();\n\\unrestrict two\n'),
  );
  assert.notEqual(dumpFingerprint('CREATE TABLE a();'), dumpFingerprint('CREATE TABLE b();'));
  assert.notEqual(dumpFingerprint("INSERT INTO a VALUES ('one');"), dumpFingerprint("INSERT INTO a VALUES ('two');"));
});

test('fingerprints normalize only associative parenthesized CHECK conjunctions', () => {
  const fingerprint = (dump: string) => dumpFingerprint(dump, 'schema');
  const source = '    CONSTRAINT budget_check CHECK ((((attempts >= 0) AND (attempts <= 3)) AND (revision > 0))),\n';
  const restored = '    CONSTRAINT budget_check CHECK (((attempts >= 0) AND (attempts <= 3) AND (revision > 0))),\n';

  assert.equal(fingerprint(source), fingerprint(restored));
  assert.equal(
    fingerprint(restored),
    fingerprint('    CONSTRAINT budget_check CHECK (((attempts >= 0) AND ((attempts <= 3) AND (revision > 0)))),\n'),
  );
  for (const changed of [
    restored.replace('<= 3', '<= 4'),
    restored.replace('> 0', '>= 0'),
    restored.replace(' AND ', ' OR '),
    restored.replace('budget_check', 'another_check'),
  ]) {
    assert.notEqual(fingerprint(source), fingerprint(changed));
  }
  const groupedOr = '    CONSTRAINT c CHECK ((((a OR b) AND (c)) AND (d))),\n';

  assert.equal(fingerprint(groupedOr), fingerprint('    CONSTRAINT c CHECK (((a OR b) AND (c) AND (d))),\n'));
  assert.notEqual(fingerprint(groupedOr), fingerprint('    CONSTRAINT c CHECK ((a OR (b AND c AND d))),\n'));
});

test('fingerprints preserve quoted CHECK material and data that resembles a schema constraint', () => {
  const quoted = "    CONSTRAINT c CHECK ((((name = 'a') AND (x)) AND (y))),\n";

  assert.notEqual(dumpFingerprint(quoted, 'schema'), dumpFingerprint(quoted.replace("'a'", "'b'"), 'schema'));
  assert.notEqual(
    dumpFingerprint(quoted, 'schema'),
    dumpFingerprint(quoted.replace("(((name = 'a') AND (x)) AND (y))", "((name = 'a') AND (x) AND (y))"), 'schema'),
  );
  const data = "INSERT INTO a VALUES ('CONSTRAINT c CHECK ((((x) AND (y)) AND (z)))');\n";

  assert.notEqual(
    dumpFingerprint(data),
    dumpFingerprint(data.replace('(((x) AND (y)) AND (z))', '((x) AND (y) AND (z))')),
  );
  const multilineData = "INSERT INTO a VALUES ('line\n    CONSTRAINT c CHECK ((((x) AND (y)) AND (z)))\n');\n";

  assert.notEqual(
    dumpFingerprint(multilineData),
    dumpFingerprint(multilineData.replace('(((x) AND (y)) AND (z))', '((x) AND (y) AND (z))')),
  );
});

test('schema fingerprints preserve function bodies containing constraint-like text', () => {
  const body =
    'CREATE FUNCTION f() RETURNS text AS $body$\n    CONSTRAINT c CHECK ((((x) AND (y)) AND (z)))\n$body$ LANGUAGE sql;\n';

  assert.notEqual(
    dumpFingerprint(body, 'schema'),
    dumpFingerprint(body.replace('(((x) AND (y)) AND (z))', '((x) AND (y) AND (z))'), 'schema'),
  );
});

test('restore uses a new database, verifies both fingerprints and removes its backup', () => {
  const commands: string[][] = [];
  const execute = ((_engine: string, args: string[]) => {
    commands.push(args);

    return {
      status: 0,
      stdout: args.includes('--schema-only') ? 'schema' : args.includes('--data-only') ? 'data' : '',
    };
  }) as typeof spawnSync;

  assert.deepEqual(restoreOwnedPostgres('docker', 'visomi-template-012345abcdef-postgres', execute), {
    schema: dumpFingerprint('schema'),
    data: dumpFingerprint('data'),
  });
  assert.ok(commands.some((args) => args.includes('createdb') && args.includes('template_restore')));
  assert.ok(
    commands.some(
      (args) =>
        args.includes('pg_restore') && args.includes('--single-transaction') && args.includes('--exit-on-error'),
    ),
  );
  assert.ok(commands.some((args) => args.some((arg) => arg.startsWith('umask 077; pg_dump'))));
  assert.deepEqual(commands.at(-1)?.slice(2), ['rm', '-f', '/tmp/restore-proof.dump']);
  assert.ok(!commands.flat().includes('dropdb'));
});

test('restore failures suppress raw stderr and still remove the backup', () => {
  const commands: string[][] = [];
  const execute = ((_engine: string, args: string[]) => {
    commands.push(args);

    return { status: args.includes('pg_restore') ? 1 : 0, stdout: '', stderr: 'database-secret' };
  }) as typeof spawnSync;

  assert.throws(() => restoreOwnedPostgres('podman', 'visomi-template-012345abcdef-postgres', execute), {
    message: 'Disposable PostgreSQL restore command failed; raw database output suppressed.',
  });
  assert.deepEqual(commands.at(-1)?.slice(2), ['rm', '-f', '/tmp/restore-proof.dump']);
});

test('restore rejects data corruption even when pg_restore reports success', () => {
  const execute = ((_engine: string, args: string[]) => ({
    status: 0,
    stdout: args.includes('--data-only') && args.includes('template_restore') ? 'corrupted' : '',
  })) as typeof spawnSync;

  assert.throws(() => restoreOwnedPostgres('docker', 'visomi-template-012345abcdef-postgres', execute), {
    message: 'Restored schema or data fingerprint differs from the source.',
  });
});

test('TOTP fixture enters the dump via SQL stdin and authenticates the database-restored ciphertext', () => {
  const directory = mkdtempSync(join(tmpdir(), 'totp-database-test-'));
  const fixture = createProtectedTotpFixture(directory);
  const commands: string[][] = [];
  const statements: string[] = [];
  const execute = ((_engine: string, args: string[], options: { input?: string }) => {
    commands.push(args);
    if (options.input) statements.push(options.input);

    return { status: 0, stdout: options.input?.startsWith('SELECT') ? `${fixture.encryptedSecret}\n` : '' };
  }) as typeof spawnSync;

  try {
    const result = restoreOwnedPostgres('docker', 'visomi-template-012345abcdef-postgres', execute, fixture);

    assert.deepEqual(result.totpKeyContinuity, {
      scope: 'synthetic-totp-v1-record',
      keyVersion: 1,
      authenticatedDecryption: true,
      missingKeyRejected: true,
      wrongKeyRejected: true,
    });
    assert.ok(statements[0].includes(fixture.encryptedSecret));
    assert.ok(statements[0].includes('CREATE SCHEMA restore_fixture'));
    assert.ok(statements[1].startsWith('SELECT encrypted_secret'));
    assert.ok(commands.some((args) => args.includes('template_restore') && args.includes('psql')));
    assert.ok(!JSON.stringify(commands).includes(fixture.encryptedSecret));
    assert.ok(!JSON.stringify(commands).includes('server-key'));
  } finally {
    fixture.cleanup();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('missing restored TOTP fixture prevents positive restore evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'totp-database-test-'));
  const fixture = createProtectedTotpFixture(directory);
  const execute = ((_engine: string, _args: string[]) => ({ status: 0, stdout: '' })) as typeof spawnSync;

  try {
    assert.throws(
      () => restoreOwnedPostgres('docker', 'visomi-template-012345abcdef-postgres', execute, fixture),
      /ciphertext differs/,
    );
  } finally {
    fixture.cleanup();
    rmSync(directory, { recursive: true, force: true });
  }
});
