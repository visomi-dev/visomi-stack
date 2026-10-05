import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

import { env } from '../env';

import { getPool } from './pool';
import * as schema from './schema';

// The composed gateway loads separately bundled API, realtime and worker modules.
// Memory mode must share one database, just as those runtimes share PostgreSQL in production.
const memoryKey = Symbol.for('visomi.memory.database');
const registry = globalThis as typeof globalThis & { [memoryKey]?: PGlite };

function getDb() {
  if (env.DATABASE_DRIVER === 'memory') {
    registry[memoryKey] ??= new PGlite();

    return drizzlePglite({
      casing: 'snake_case',
      client: registry[memoryKey],
      schema,
    });
  }

  return drizzleNodePg({
    casing: 'snake_case',
    client: getPool(),
    schema,
  });
}

const db = getDb();

export { db, getDb };
