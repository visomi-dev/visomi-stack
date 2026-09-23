import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

import * as crypto from './auth-crypto';
import { clearMailbox, listSentMessages } from './auth-mail';
import {
  completePasswordReset,
  findOrCreateUserByEmail,
  replaceRecoveryCodes,
  startPasswordReset,
} from './auth-service';
import { resetPasskeySecurityState } from './passkey-security';

import { db, userRecoveryCodes, userTotpEnrollments, users } from 'shared';

jest.mock('shared', () => {
  const actual = jest.requireActual('shared');
  const { Pool } = jest.requireActual('pg');
  const { drizzle } = jest.requireActual('drizzle-orm/node-postgres');
  const { randomUUID } = jest.requireActual('node:crypto');
  const schema = `recovery_lock_${randomUUID().replace(/-/g, '')}`;
  const pool = new Pool({
    connectionString: process.env['AUTH_LOCK_TEST_DATABASE_URL'],
    application_name: schema,
    options: `-c search_path=${schema}`,
    max: 4,
    statement_timeout: 10_000,
  });

  return { ...actual, db: drizzle({ client: pool, casing: 'snake_case' }) };
});
jest.mock('../shared/env', () => ({
  env: { ...jest.requireActual('../shared/env').env, DATABASE_DRIVER: 'memory', MAIL_TRANSPORT: 'memory' },
}));

const suite = process.env['AUTH_LOCK_TEST_DATABASE_URL'] ? describe : describe.skip;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

suite('PostgreSQL recovery-code lock ordering', () => {
  const pool = (db as unknown as { $client: Pool }).$client;
  let schema: string;

  beforeAll(async () => {
    const result = await pool.query<{ schema: string }>("SELECT current_setting('application_name') AS schema");

    schema = result.rows[0].schema;
    await pool.query(`CREATE SCHEMA ${schema}`);
    await migrate(db as unknown as NodePgDatabase, {
      migrationsFolder: resolve(process.cwd(), 'drizzle'),
      migrationsSchema: schema,
    });
  }, 30_000);

  afterAll(async () => {
    try {
      if (schema) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await pool.end();
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearMailbox();
    resetPasskeySecurityState();
  });

  it('lets an anonymous reset finish while regeneration waits on its user lock, without locking codes first', async () => {
    const user = await findOrCreateUserByEmail(`${randomUUID()}@example.test`);

    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
    await db.insert(userTotpEnrollments).values({
      id: randomUUID(),
      userId: user.id,
      encryptedSecret: 'unused-for-recovery-code',
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [code] = await replaceRecoveryCodes(user.id);
    const flow = await startPasswordReset(user.email, 'reset-context', 'reset-session');
    const pin = listSentMessages().find((message) => message.challengeId === flow.flowId)!.pin;
    const entered = deferred();
    const resume = deferred();
    const verifySecret = crypto.verifySecret;
    let paused = false;

    // The real reset holds user/flow/email locks and has read the recovery codes.
    jest.spyOn(crypto, 'verifySecret').mockImplementation(async (secret, hash) => {
      if (secret === code && !paused) {
        paused = true;
        entered.resolve();
        await resume.promise;
      }

      return verifySecret(secret, hash);
    });
    const reset = Promise.allSettled([
      completePasswordReset(
        flow.flowId,
        pin,
        { kind: 'recovery_code', code },
        'a new secure recovery password',
        'reset-context',
        'reset-session',
        'reset-ip',
      ),
    ]);
    let regeneration: Promise<PromiseSettledResult<string[]>[]> | undefined;

    try {
      await entered.promise;
      const holder = await pool.query<{ pid: number }>(
        "SELECT pid FROM pg_stat_activity WHERE application_name = $1 AND state = 'idle in transaction'",
        [schema],
      );

      expect(holder.rows).toHaveLength(1);
      regeneration = Promise.allSettled([replaceRecoveryCodes(user.id)]);
      const deadline = Date.now() + 5_000;
      let waiter: { pid: number; query: string } | undefined;

      // Observe PostgreSQL's actual wait graph, rather than relying on a timed race.
      while (!waiter && Date.now() < deadline) {
        const result = await pool.query<{ pid: number; query: string }>(
          'SELECT pid, query FROM pg_stat_activity WHERE application_name = $1 AND $2 = ANY(pg_blocking_pids(pid))',
          [schema, holder.rows[0].pid],
        );

        waiter = result.rows[0];
        if (!waiter) await new Promise<void>((done) => setTimeout(done, 10));
      }
      expect(waiter).toBeDefined();
      expect(waiter?.pid).not.toBe(holder.rows[0].pid);
      expect(waiter?.query).toMatch(/select .*users.*for update/i);
    } finally {
      resume.resolve();
      await reset;
      await regeneration;
    }
    expect(await reset).toEqual([{ status: 'fulfilled', value: undefined }]);
    const [regenerated] = await regeneration!;

    expect(regenerated.status).toBe('fulfilled');
    const saved = await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, user.id));
    const [updated] = await db.select().from(users).where(eq(users.id, user.id));

    expect(saved).toHaveLength(10);
    expect(saved.every((item) => item.usedAt === null)).toBe(true);
    expect(updated.authVersion).toBe(user.authVersion + 1);
  }, 20_000);
});
