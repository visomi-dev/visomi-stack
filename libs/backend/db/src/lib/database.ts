import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export type Database = ReturnType<typeof drizzle>;
export type DatabaseResource = ReturnType<typeof createDatabase>;

export function createDatabase(connectionString: string, onError: () => void = () => undefined) {
  let url: URL;

  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('database_configuration_invalid');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('database_configuration_invalid');
  }

  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000 });

  pool.on('error', () => onError());
  const db = drizzle({ client: pool, logger: false });
  let closing: Promise<void> | undefined;

  return { pool, db, close: () => (closing ??= pool.end()) };
}
