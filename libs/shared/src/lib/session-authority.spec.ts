import { randomUUID } from 'node:crypto';

import { Cookie } from 'express-session';
import type { SessionData } from 'express-session';
import { Pool } from 'pg';

import { ManagedMemorySessionStore, PostgresSessionStore } from './session';
import type { SessionAuthorityStore, ManagedSessionStore, SessionScope } from './session';

type AuthorityStore = SessionAuthorityStore & ManagedSessionStore;
const databaseUrl = process.env['SESSION_AUTHORITY_TEST_DATABASE_URL'];
const scope: SessionScope = { userId: 'alice', authVersion: 1, currentSid: 'controller', secret: 'test-secret' };
const victim = { ...scope, currentSid: 'victim' };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

function payload(): SessionData {
  const cookie = new Cookie();

  cookie.expires = new Date(Date.now() + 60000);

  return { cookie, ...{ authority: 'full', passport: { user: { id: 'alice', authVersion: 1 } } } };
}

function save(store: AuthorityStore, sid: string, data = payload()): Promise<void> {
  return new Promise((resolve, reject) => store.set(sid, data, (error) => (error ? reject(error) : resolve())));
}

function destroy(store: AuthorityStore, sid: string): Promise<void> {
  return new Promise((resolve, reject) => store.destroy(sid, (error) => (error ? reject(error) : resolve())));
}

for (const backend of ['memory', 'postgres'] as const) {
  const suite = backend === 'postgres' && !databaseUrl ? describe.skip : describe;

  suite(`${backend} authoritative session leases`, () => {
    let store: AuthorityStore;
    let peer: AuthorityStore;
    let dataPool: Pool | undefined;
    let lockPool: Pool | undefined;
    let table: string;

    beforeEach(async () => {
      if (backend === 'memory') {
        store = new ManagedMemorySessionStore();
        peer = store;
      } else {
        dataPool = new Pool({ connectionString: databaseUrl, max: 2 });
        lockPool = new Pool({ connectionString: databaseUrl, max: 4 });
        table = `session_test_${randomUUID().replace(/-/g, '')}`;
        await dataPool.query(`CREATE TABLE ${table} (sid text PRIMARY KEY, sess jsonb NOT NULL,
          expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW(),
          updated_at timestamptz NOT NULL DEFAULT NOW(), revoked_at timestamptz)`);
        await dataPool.query(`CREATE TABLE ${table}_effects (id integer)`);
        store = new PostgresSessionStore(dataPool, table, lockPool);
        // Separate store/ALS instance models independently bundled or separate API processes.
        peer = new PostgresSessionStore(dataPool, table, lockPool);
      }
      await save(store, 'controller');
      await save(store, 'victim');
    });

    afterEach(async () => {
      if (dataPool) {
        await dataPool.query(`DROP TABLE ${table}`);
        await dataPool.query(`DROP TABLE ${table}_effects`);
        await lockPool?.end();
        await dataPool.end();
      }
    });

    it('finishes an admitted deferred mutation before revocation can linearize', async () => {
      const entered = deferred();
      const finish = deferred();
      const events: string[] = [];
      const operation = store.withSessionAuthority(victim, async () => {
        entered.resolve();
        await finish.promise;
        if (dataPool) {
          const transaction = await dataPool.connect();

          try {
            await transaction.query('BEGIN');
            await transaction.query(`INSERT INTO ${table}_effects (id) VALUES (1)`);
            await transaction.query('COMMIT');
          } finally {
            transaction.release();
          }
        }
        events.push('committed');
      });

      await entered.promise;
      const revocation = peer.revokeManagedSessions(scope).then((count) => {
        events.push('revoked');

        return count;
      });

      await new Promise<void>((resolve) => setImmediate(resolve));
      const prematureRevocation = events.includes('revoked');

      finish.resolve();
      await operation;
      expect(await revocation).toBe(1);
      expect(prematureRevocation).toBe(false);
      expect(events).toEqual(['committed', 'revoked']);
      if (dataPool) expect((await dataPool.query(`SELECT id FROM ${table}_effects`)).rows).toEqual([{ id: 1 }]);
    });

    it('rejects work from a previously loaded request after revocation succeeds', async () => {
      const snapshot = await new Promise<SessionData | null | undefined>((resolve, reject) =>
        store.get('victim', (error, data) => (error ? reject(error) : resolve(data))),
      );
      let committed = false;

      expect(snapshot).toBeTruthy();
      expect(await peer.revokeManagedSessions(scope)).toBe(1);
      await expect(
        store.withSessionAuthority(victim, async () => {
          committed = true;
        }),
      ).rejects.toMatchObject({ code: 'session_authority_invalid' });
      await save(store, 'victim', snapshot!);
      await expect(
        store.withSessionAuthority(victim, async () => {
          committed = true;
        }),
      ).rejects.toMatchObject({ code: 'session_authority_invalid' });
      expect(committed).toBe(false);
    });

    it('serializes direct destroy against an in-flight mutation', async () => {
      const entered = deferred();
      const finish = deferred();
      const events: string[] = [];
      const operation = store.withSessionAuthority(victim, async () => {
        entered.resolve();
        await finish.promise;
        events.push('committed');
      });

      await entered.promise;
      const destruction = destroy(peer, 'victim').then(() => {
        events.push('destroyed');
      });

      finish.resolve();
      await Promise.all([operation, destruction]);
      expect(events).toEqual(['committed', 'destroyed']);
      await expect(store.withSessionAuthority(victim, async () => undefined)).rejects.toMatchObject({
        code: 'session_authority_invalid',
      });
    });

    it('supports same-request destruction and nested revocation without lock upgrades', async () => {
      await store.withSessionAuthority(scope, async () => {
        expect(await store.revokeManagedSessions(scope)).toBe(1);
        await destroy(store, scope.currentSid);
        await save(store, 'regenerated');
      });
      await expect(store.withSessionAuthority({ ...scope, currentSid: 'regenerated' }, async () => 'ok')).resolves.toBe(
        'ok',
      );
    });

    it('releases leases when protected work fails', async () => {
      await expect(
        store.withSessionAuthority(victim, async () => {
          throw new Error('transaction failed');
        }),
      ).rejects.toThrow('transaction failed');
      expect(await peer.revokeManagedSessions(scope)).toBe(1);
    });

    it('rejects a revoked current caller trying to revoke another session', async () => {
      await destroy(peer, scope.currentSid);
      await expect(store.revokeManagedSessions(scope)).rejects.toMatchObject({ code: 'session_authority_invalid' });
      await expect(peer.withSessionAuthority(victim, async () => 'still active')).resolves.toBe('still active');
    });

    it('serializes mutually competing revocations without lock-upgrade deadlocks', async () => {
      const outcomes = await Promise.allSettled([
        store.revokeManagedSessions(scope),
        peer.revokeManagedSessions(victim),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toEqual([{ status: 'fulfilled', value: 1 }]);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([
        expect.objectContaining({ reason: expect.objectContaining({ code: 'session_authority_invalid' }) }),
      ]);
    });
  });
}
