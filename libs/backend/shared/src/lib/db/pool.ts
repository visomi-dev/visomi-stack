import { Pool } from 'pg';

import { env } from '../env';

let pool: Pool | undefined;

let cachedUrl: string | undefined;

function getPool() {
  if (env.DATABASE_DRIVER !== 'pg') {
    throw new Error('Postgres pool requested while DATABASE_DRIVER is not pg.');
  }

  if (!pool || cachedUrl !== env.DATABASE_URL) {
    pool?.end().catch(() => undefined);
    cachedUrl = env.DATABASE_URL;
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    });
  }

  return pool;
}

export { getPool };
