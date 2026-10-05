import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { db } from '../db/client';
import { accountMemberships, accounts, durableOperations, notificationInbox, users } from '../db/schema';

import {
  acceptDurableOperation,
  claimDurableOperation,
  expireDurableOperations,
  finishDurableOperation,
  readOperation,
} from './store';
import type { OperationOwner } from './contract';

jest.mock('../env', () => ({ env: { DATABASE_DRIVER: 'memory', SESSION_SECRET: 'operation-test-secret' } }));
jest.mock('../redis/pub-sub', () => ({ publishJson: jest.fn().mockResolvedValue(undefined) }));

beforeAll(async () => {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: resolve(__dirname, '../../../../../../drizzle') });
  await db.execute(sql.raw('CREATE ROLE operation_reader'));
  await db.execute(sql.raw('GRANT SELECT ON durable_operations TO operation_reader'));
}, 30000);
afterAll(async () => {
  await (db as unknown as { $client: PGlite }).$client.close();
});
beforeEach(async () => {
  await db.delete(durableOperations);
});

async function identity(): Promise<OperationOwner> {
  const owner = { userId: randomUUID(), accountId: randomUUID(), sessionId: randomUUID(), authVersion: 1 };

  await db.insert(users).values({ id: owner.userId, email: `${owner.userId}@example.test` });
  await db
    .insert(accounts)
    .values({ id: owner.accountId, ownerUserId: owner.userId, name: 'Workspace', slug: owner.accountId });
  await db
    .insert(accountMemberships)
    .values({ id: randomUUID(), accountId: owner.accountId, userId: owner.userId, role: 'owner' });

  return owner;
}

describe('durable operations', () => {
  it('enforces migration RLS for a non-owner database role and transaction-local account context', async () => {
    const owner = await identity();
    const other = await identity();

    await acceptDurableOperation(
      owner,
      { requestKey: randomUUID(), kind: 'project_seed', fingerprint: 'first' },
      async () => ({}),
    );
    await acceptDurableOperation(
      other,
      { requestKey: randomUUID(), kind: 'project_seed', fingerprint: 'second' },
      async () => ({}),
    );
    const rows = await db.transaction(async (transaction) => {
      await transaction.execute(sql.raw('SET LOCAL ROLE operation_reader'));
      await transaction.execute(sql`SELECT set_config('app.current_account_id', ${owner.accountId}, true)`);

      return transaction.select().from(durableOperations);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].accountId).toBe(owner.accountId);
    const unscoped = await db.transaction(async (transaction) => {
      await transaction.execute(sql.raw('SET LOCAL ROLE operation_reader'));

      return transaction.select().from(durableOperations);
    });

    expect(unscoped).toHaveLength(0);
  });
  it('persists acceptance atomically with prepared routing metadata and rolls back failed preparation', async () => {
    const owner = await identity();

    await expect(
      acceptDurableOperation(
        owner,
        { requestKey: randomUUID(), kind: 'project_seed', fingerprint: 'first' },
        async () => {
          throw new Error('Preparation failed');
        },
      ),
    ).rejects.toThrow('Preparation failed');
    expect(await db.select().from(durableOperations)).toHaveLength(0);
    const operation = await acceptDurableOperation(
      owner,
      { requestKey: randomUUID(), kind: 'project_seed', fingerprint: 'first' },
      async () => ({ projectId: 'routing-only' }),
    );

    expect(await readOperation(operation.id, owner)).toEqual({ operationId: operation.id, status: 'pending' });
  });

  it('deduplicates concurrent acceptance and rejects reuse for different inputs', async () => {
    const owner = await identity();
    const requestKey = randomUUID();
    const prepare = jest.fn(async () => ({ projectId: 'routing-only' }));
    const input = { requestKey, kind: 'project_seed', fingerprint: 'first' };
    const [first, second] = await Promise.all([
      acceptDurableOperation(owner, input, prepare),
      acceptDurableOperation(owner, input, prepare),
    ]);

    expect(second.id).toBe(first.id);
    expect(prepare).toHaveBeenCalledTimes(1);
    await expect(acceptDurableOperation(owner, { ...input, fingerprint: 'different' }, prepare)).rejects.toMatchObject({
      code: 'operation_request_conflict',
    });
  });

  it('isolates results by session, account, identity, auth version and current membership', async () => {
    const owner = await identity();
    const other = await identity();
    const operation = await acceptDurableOperation(
      owner,
      { requestKey: randomUUID(), kind: 'project_seed', fingerprint: 'first' },
      async () => ({}),
    );

    for (const foreign of [
      other,
      { ...owner, sessionId: randomUUID() },
      { ...owner, accountId: other.accountId },
      { ...owner, authVersion: 2 },
    ]) {
      expect(await readOperation(operation.id, foreign)).toBeNull();
    }
    await db.delete(accountMemberships).where(eq(accountMemberships.userId, owner.userId));
    expect(await readOperation(operation.id, owner)).toBeNull();
  });

  it('claims once, rejects stale lease completion and preserves committed results across Redis failure', async () => {
    const owner = await identity();
    const operation = await acceptDurableOperation(
      owner,
      { requestKey: randomUUID(), kind: 'project_seed', fingerprint: 'first' },
      async () => ({}),
    );
    const claimed = await claimDurableOperation(['project_seed']);

    expect(claimed?.id).toBe(operation.id);
    expect(await claimDurableOperation(['project_seed'])).toBeNull();
    if (!claimed) throw new Error('Expected a claimed operation.');
    expect(
      await finishDurableOperation(
        { ...claimed, lease: randomUUID() },
        { operationId: claimed.id, status: 'completed', result: { jobId: claimed.id } },
      ),
    ).toBe(false);
    const { publishJson } = jest.requireMock('../redis/pub-sub') as { publishJson: jest.Mock };

    publishJson.mockRejectedValueOnce(new Error('Redis is unavailable'));
    expect(
      await finishDurableOperation(claimed, {
        operationId: claimed.id,
        status: 'completed',
        result: { jobId: claimed.id },
      }),
    ).toBe(true);
    expect(await readOperation(claimed.id, owner)).toEqual({
      operationId: claimed.id,
      status: 'completed',
      result: { jobId: claimed.id },
    });
    expect(await finishDurableOperation(claimed, { operationId: claimed.id, status: 'failed' })).toBe(false);
    const notifications = await db.select().from(notificationInbox).where(eq(notificationInbox.id, claimed.id));

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      accountId: owner.accountId,
      userId: owner.userId,
      kind: 'service',
      read: false,
    });
  });

  it('recovers an abandoned lease and rejects late completion by its previous worker', async () => {
    const owner = await identity();

    await acceptDurableOperation(
      owner,
      { requestKey: randomUUID(), kind: 'project_seed', fingerprint: 'first' },
      async () => ({}),
    );
    const first = await claimDurableOperation(['project_seed']);

    if (!first) throw new Error('Expected a claimed operation.');
    await db
      .update(durableOperations)
      .set({ availableAt: new Date(0) })
      .where(eq(durableOperations.id, first.id));
    const retry = await claimDurableOperation(['project_seed']);

    expect(retry?.attempts).toBe(2);
    expect(retry?.lease).not.toBe(first.lease);
    expect(await finishDurableOperation(first, { operationId: first.id, status: 'completed' })).toBe(false);
  });

  it('rolls back completion when inbox persistence fails and recovers with the same valid lease', async () => {
    const owner = await identity();

    await acceptDurableOperation(
      owner,
      { requestKey: randomUUID(), kind: 'project_seed', fingerprint: 'atomic-inbox' },
      async () => ({}),
    );
    const claimed = await claimDurableOperation(['project_seed']);

    if (!claimed) throw new Error('Expected a claimed operation.');
    await db.execute(
      sql.raw(
        "CREATE FUNCTION reject_notification_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Inbox fixture unavailable'; END $$",
      ),
    );
    await db.execute(
      sql.raw(
        'CREATE TRIGGER reject_notification_fixture BEFORE INSERT ON notification_inbox FOR EACH ROW EXECUTE FUNCTION reject_notification_fixture()',
      ),
    );
    try {
      await expect(finishDurableOperation(claimed, { operationId: claimed.id, status: 'completed' })).rejects.toThrow();
      expect(await readOperation(claimed.id, owner)).toMatchObject({ status: 'running' });
    } finally {
      await db.execute(sql.raw('DROP TRIGGER reject_notification_fixture ON notification_inbox'));
      await db.execute(sql.raw('DROP FUNCTION reject_notification_fixture()'));
    }
    expect(await finishDurableOperation(claimed, { operationId: claimed.id, status: 'completed' })).toBe(true);
    const notifications = await db.select().from(notificationInbox).where(eq(notificationInbox.id, claimed.id));

    expect(notifications).toHaveLength(1);
  });

  it('expires abandoned operations, caps attempts and rejects content-bearing completion fields', async () => {
    const owner = await identity();
    const operation = await acceptDurableOperation(
      owner,
      { requestKey: randomUUID(), kind: 'project_seed', fingerprint: 'first' },
      async () => ({}),
    );

    await db
      .update(durableOperations)
      .set({ status: 'running', attempts: 3, availableAt: new Date(0) })
      .where(eq(durableOperations.id, operation.id));
    await expireDurableOperations();
    expect(await readOperation(operation.id, owner)).toMatchObject({
      status: 'failed',
      error: { code: 'operation_attempts_exhausted' },
    });
    await db
      .update(durableOperations)
      .set({ expiresAt: new Date(0) })
      .where(eq(durableOperations.id, operation.id));
    expect(await readOperation(operation.id, owner)).toBeNull();
    await expect(
      finishDurableOperation(
        { ...operation, lease: randomUUID() },
        {
          operationId: operation.id,
          status: 'completed',
          result: { jobId: 'plaintext' },
        },
      ),
    ).rejects.toThrow();
  });
});
