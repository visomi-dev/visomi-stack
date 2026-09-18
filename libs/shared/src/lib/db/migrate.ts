import { resolve } from 'node:path';

import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgliteDatabase } from 'drizzle-orm/pglite';

import { env } from '../env';

import { db } from './client';
import type * as schema from './schema';

let migrationPromise: Promise<void> | undefined;

async function runMigrationsIfEnabled() {
  if (!env.DATABASE_AUTO_MIGRATE) {
    return;
  }

  migrationPromise ??=
    env.DATABASE_DRIVER === 'memory'
      ? migratePglite(db as PgliteDatabase<typeof schema>, {
          migrationsFolder: resolve(process.cwd(), 'drizzle'),
        }).then(() => undefined)
      : migrateNodePg(db as NodePgDatabase<typeof schema>, {
          migrationsFolder: resolve(process.cwd(), 'drizzle'),
        }).then(() => undefined);

  await migrationPromise;
}

export { runMigrationsIfEnabled };
