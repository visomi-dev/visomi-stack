import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

import { env } from '../env';

import { getPool } from './pool';
import * as schema from './schema';

let pgliteClient: PGlite | undefined;

function getDb() {
  if (env.DATABASE_DRIVER === 'memory') {
    pgliteClient ??= new PGlite();

    return drizzlePglite({
      casing: 'snake_case',
      client: pgliteClient,
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
