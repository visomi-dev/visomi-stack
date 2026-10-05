import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migrateMemory } from 'drizzle-orm/pglite/migrator';

import { accounts, db, env, getPool, users } from 'shared';

/** Explicit opt-in prevents inherited .env from authorizing disposable PostgreSQL test mutations. */
export async function migrateVaultTestDatabase(): Promise<void> {
  const migrationsFolder = resolve(process.cwd(), 'drizzle');

  if (env.DATABASE_DRIVER === 'memory') {
    await migrateMemory(db as unknown as PgliteDatabase, { migrationsFolder });

    return;
  }
  const explicit = process.env['VAULT_UNLOCK_TEST_DATABASE_URL'];
  const url = explicit ? new URL(explicit) : undefined;

  if (
    !url ||
    explicit !== env.DATABASE_URL ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/themis_api_e2e' ||
    !['postgres:', 'postgresql:'].includes(url.protocol)
  ) {
    throw new Error('Vault PostgreSQL tests require an explicit loopback themis_api_e2e database URL.');
  }
  await migratePg(db as unknown as NodePgDatabase, { migrationsFolder });
}

export async function closeVaultTestDatabase(owners: readonly { userId: string; accountId: string }[]): Promise<void> {
  if (env.DATABASE_DRIVER === 'memory') {
    await (db as unknown as { $client: PGlite }).$client.close();

    return;
  }
  try {
    for (const owner of owners) {
      await db.delete(accounts).where(eq(accounts.id, owner.accountId));
      await db.delete(users).where(eq(users.id, owner.userId));
    }
  } finally {
    await getPool().end();
  }
}
