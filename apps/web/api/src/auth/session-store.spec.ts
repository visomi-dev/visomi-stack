import { PGlite } from '@electric-sql/pglite';
import { Cookie } from 'express-session';
import type { SessionData } from 'express-session';
import type { Pool } from 'pg';

import { PostgresSessionStore } from 'shared';
import type { SessionScope } from 'shared';

describe('Postgres session tombstones', () => {
  let database: PGlite;
  let store: PostgresSessionStore;
  let pool: Pool;
  const scope: SessionScope = { userId: 'alice', authVersion: 2, currentSid: 'current', secret: 'test-secret' };

  function payload(userId = 'alice', authVersion = 2, expiry = Date.now() + 60000): SessionData {
    const cookie = new Cookie();

    cookie.expires = new Date(expiry);

    return {
      cookie,
      authority: 'full',
      authenticationMethod: 'password',
      passport: { user: { id: userId, accountId: 'account', authVersion } },
    };
  }
  function save(sid: string, data = payload()): Promise<void> {
    return new Promise((resolve, reject) => store.set(sid, data, (error) => (error ? reject(error) : resolve())));
  }
  function destroy(sid: string): Promise<void> {
    return new Promise((resolve, reject) => store.destroy(sid, (error) => (error ? reject(error) : resolve())));
  }
  function get(sid: string): Promise<SessionData | null | undefined> {
    return new Promise((resolve, reject) => store.get(sid, (error, data) => (error ? reject(error) : resolve(data))));
  }
  beforeEach(async () => {
    database = new PGlite();
    await database.exec(`CREATE TABLE user_sessions (sid text PRIMARY KEY, sess jsonb NOT NULL,
      expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(), revoked_at timestamptz)`);
    const query = async (sql: string, values?: unknown[]) => {
      const result = await database.query(sql, values);

      return { rows: result.rows, rowCount: result.affectedRows };
    };

    pool = {
      query,
      connect: async () => ({ query, release: () => undefined }),
    } as unknown as Pool;

    store = new PostgresSessionStore(pool, 'user_sessions', pool);
    await save('current');
  });
  afterEach(async () => {
    await database.close();
  });

  it('filters foreign, expired and stale sessions and revokes only other sessions', async () => {
    await save('current');
    await save('other');
    await save('foreign', payload('bob'));
    await save('stale', payload('alice', 1));
    await save('expired', payload('alice', 2, Date.now() - 1000));
    const sessions = await store.listManagedSessions(scope);

    expect(sessions).toHaveLength(2);
    const other = sessions.find((item) => !item.current)!;

    await save('bob-current', payload('bob'));
    expect(await store.revokeManagedSessions({ ...scope, userId: 'bob', currentSid: 'bob-current' }, other.id)).toBe(0);
    expect(await store.revokeManagedSessions(scope)).toBe(1);
    expect(await get('other')).toBeNull();
    expect(await get('current')).toBeTruthy();
    expect(await get('foreign')).toBeTruthy();
    expect(await get('expired')).toBeNull();
  });
  it('blocks delayed set and touch after selected revocation', async () => {
    await save('other');
    const other = (await store.listManagedSessions(scope)).find((item) => !item.current)!;
    const inFlightSnapshot = await get('other');

    expect(inFlightSnapshot).toBeTruthy();
    expect(await store.revokeManagedSessions(scope, other.id)).toBe(1);
    await Promise.all([
      save('other', inFlightSnapshot!),
      new Promise<void>((resolve, reject) =>
        store.touch('other', payload(), (error) => (error ? reject(error) : resolve())),
      ),
    ]);
    expect(await get('other')).toBeNull();
    expect(await store.listManagedSessions(scope)).toEqual([expect.objectContaining({ current: true })]);
  });
  it('preserves durable revocation across store instances when an older request saves its snapshot', async () => {
    await save('other');
    const inFlightSnapshot = await get('other');

    expect(inFlightSnapshot).toBeTruthy();
    await store.revokeManagedSessions(scope);
    store = new PostgresSessionStore(pool, 'user_sessions', pool);
    await save('other', inFlightSnapshot!);
    expect(await get('other')).toBeNull();
    const result = await database.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM user_sessions WHERE sid = $1',
      ['other'],
    );

    expect(result.rows[0].revoked_at).not.toBeNull();
  });
  it('tombstones unknown SIDs and preserves regeneration with a fresh SID', async () => {
    await destroy('unknown');
    await save('unknown');
    await save('fresh');
    expect(await get('unknown')).toBeNull();
    expect(await get('fresh')).toBeTruthy();
  });
  it('serializes conflicting saves and destruction without resurrecting a SID', async () => {
    await Promise.all([save('race'), destroy('race')]);
    await save('race');
    expect(await get('race')).toBeNull();
  });
});
