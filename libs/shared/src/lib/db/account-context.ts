import { sql } from 'drizzle-orm';

import { env } from '../env';

import { getDb } from './client';

type TenantContext = {
  accountId: string;
  userId: string;
};

type AccountScopedDb = ReturnType<typeof getDb>;

async function withAccountContext<T>(context: TenantContext, operation: (db: AccountScopedDb) => Promise<T>) {
  const db = getDb();

  return db.transaction(async (tx) => {
    if (env.DATABASE_DRIVER === 'pg') {
      await tx.execute(sql`select set_config('app.current_account_id', ${context.accountId}, true)`);
      await tx.execute(sql`select set_config('app.current_user_id', ${context.userId}, true)`);
    }

    return operation(tx as unknown as AccountScopedDb);
  });
}

export { withAccountContext };
export type { TenantContext };
