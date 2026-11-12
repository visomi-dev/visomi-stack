import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Pool } from 'pg';
import { expect, it } from 'vitest';

import { testPostgres } from './postgres';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../../../../../libs/backend/shared/tools/database/migrate.mjs', import.meta.url));

it('applies the production migration command to an empty isolated database and can repeat it', async () => {
  const database = await testPostgres();
  const pool = new Pool({ connectionString: database.url });

  try {
    // This fixture owns an isolated disposable database, never the developer's DATABASE_URL.
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA drizzle CASCADE;');

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await execute(process.execPath, [script], { env: { ...process.env, DATABASE_URL: database.url } });

      expect(result.stderr).toBe('');
      const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");

      expect(tables.rows.map((row) => row.tablename)).toEqual(
        expect.arrayContaining(['auth_users', 'auth_sessions', 'auth_credentials', 'auth_flows']),
      );
      const history = await pool.query('SELECT * FROM drizzle.__drizzle_migrations');

      expect(history.rows).toHaveLength(5);
    }
  } finally {
    await pool.end();

    await database.stop();
  }
}, 60000);

it('fails with a controlled message when configuration is absent or unreachable', async () => {
  for (const url of ['', 'postgresql://synthetic:synthetic-private-password@127.0.0.1:1/unused']) {
    await expect(
      execute(process.execPath, [script], { env: { ...process.env, DATABASE_URL: url } }),
    ).rejects.toMatchObject({ code: 1, stdout: '', stderr: 'database_migration_failed\n' });
  }
});
