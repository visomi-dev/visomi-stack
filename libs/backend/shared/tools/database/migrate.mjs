import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error('database_configuration_invalid');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });

  try {
    await migrate(drizzle({ client: pool, logger: false }), {
      migrationsFolder: fileURLToPath(new URL('../../src/lib/database/migrations/', import.meta.url)),
    });
  } finally {
    await pool.end();
  }
}

// Deployment output must never include database connection details or raw SQL errors.
void run().catch(() => {
  process.stderr.write('database_migration_failed\n');
  process.exitCode = 1;
});
