import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Pool } from 'pg';

export async function testDatabasePool() {
  const text = await readFile(join(process.env.VISOMI_E2E_TELEMETRY_DIR!, 'database.json'), 'utf8');
  const url = new URL(JSON.parse(text).url);

  if (url.hostname !== '127.0.0.1' || url.pathname !== '/visomi_auth_test' || url.username !== 'visomi_test') {
    throw new Error('isolated_test_database_required');
  }

  return new Pool({ connectionString: url.toString() });
}

export async function resetAuthRateLimits() {
  const pool = await testDatabasePool();

  try {
    await pool.query('DELETE FROM auth_rate_limits');
  } finally {
    await pool.end();
  }
}
