import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, createHmac } from 'node:crypto';

import session, { Store, type SessionData, type SessionOptions } from 'express-session';
import { Pool, type PoolClient } from 'pg';

type SessionConfig = {
  cookieSecure: boolean;
  databaseDriver: 'memory' | 'pg';
  sessionMaxAgeMs: number;
  sessionSecret: string;
};

type SessionCallback = (error?: unknown, session?: SessionData | null) => void;

type SessionRow = {
  sid: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  sess: SessionData | string;
};

export type SessionScope = { userId: string; authVersion: number; currentSid: string; secret: string };
export type SessionAuthorityScope = Omit<SessionScope, 'secret'> & { authority?: 'full' | 'restricted' };
export type SessionAuthorityStore = Store & {
  withSessionAuthority<T>(scope: SessionAuthorityScope, operation: () => Promise<T>): Promise<T>;
};

export function isSessionAuthorityStore(store: Store): store is SessionAuthorityStore {
  return Boolean(store) && 'withSessionAuthority' in store && typeof store.withSessionAuthority === 'function';
}

export class SessionAuthorityError extends Error {
  readonly code = 'session_authority_invalid';

  constructor() {
    super('The session is no longer authorized.');
  }
}

type LeaseContext = { keys: Set<string>; active: boolean; client?: PoolClient };

// Store-owned ALS is intentional: gateway/API bundles share the store, not module identities.
class SessionLeases {
  private readonly context = new AsyncLocalStorage<LeaseContext>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly pool?: Pick<Pool, 'connect'>) {}

  async run<T>(keys: string[], operation: () => Promise<T>): Promise<T> {
    const inherited = this.context.getStore();

    if (inherited?.active) return this.acquire(inherited, keys, operation);
    const state: LeaseContext = { keys: new Set(), active: true, client: await this.pool?.connect() };

    try {
      return await this.context.run(state, () => this.acquire(state, keys, operation));
    } finally {
      state.active = false;
      state.client?.release();
    }
  }

  private async acquire<T>(state: LeaseContext, keys: string[], operation: () => Promise<T>): Promise<T> {
    const [key, ...rest] = keys;

    if (!key) return operation();
    if (state.keys.has(key)) return this.acquire(state, rest, operation);
    // A SID-only operation must never upgrade to a user lock.
    if (key.startsWith('user:') && [...state.keys].some((held) => held.startsWith('sid:'))) {
      throw new Error('Session lease lock order violation');
    }
    const release = await this.lock(state, key);

    state.keys.add(key);
    try {
      return await this.acquire(state, rest, operation);
    } finally {
      state.keys.delete(key);
      await release();
    }
  }

  private async lock(state: LeaseContext, key: string): Promise<() => Promise<void>> {
    if (state.client) {
      const client = state.client;
      const id = createHash('sha256').update(`session-authority-v1:${key}`).digest().readBigInt64BE().toString();

      await client.query('SELECT pg_advisory_lock($1::bigint)', [id]);

      return async () => {
        try {
          await client.query('SELECT pg_advisory_unlock($1::bigint)', [id]);
        } catch (error) {
          // Never return a connection carrying an unreleased session-level lock to the pool.
          state.client = undefined;
          client.release(true);
          throw error;
        }
      };
    }
    const previous = this.pending.get(key) ?? Promise.resolve();
    let unlock!: () => void;
    const current = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const tail = previous.then(() => current);

    this.pending.set(key, tail);
    await previous;

    return async () => {
      unlock();
      if (this.pending.get(key) === tail) this.pending.delete(key);
    };
  }
}

function assertSessionAuthority(sess: SessionData | null | undefined, scope: SessionAuthorityScope): void {
  const data = record(sess);
  const user = record(record(data?.['passport'])?.['user']);

  if (
    !data ||
    data['authority'] !== (scope.authority ?? 'full') ||
    user?.['id'] !== scope.userId ||
    user['authVersion'] !== scope.authVersion
  )
    throw new SessionAuthorityError();
}
export type ManagedSession = {
  id: string;
  current: boolean;
  startedAt: string;
  lastActiveAt: string;
  expiresAt: string;
  method: 'password' | 'passkey' | 'google' | 'unknown';
};
export type ManagedSessionStore = Store & {
  listManagedSessions(scope: SessionScope): Promise<ManagedSession[]>;
  revokeManagedSessions(scope: SessionScope, id?: string): Promise<number>;
};

export function isManagedSessionStore(store: Store): store is ManagedSessionStore {
  return (
    'listManagedSessions' in store &&
    typeof store.listManagedSessions === 'function' &&
    'revokeManagedSessions' in store &&
    typeof store.revokeManagedSessions === 'function'
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function managed(row: SessionRow, scope: SessionScope): ManagedSession | undefined {
  const payload: unknown = typeof row.sess === 'string' ? JSON.parse(row.sess) : row.sess;
  const data = record(payload);
  const user = record(record(data?.['passport'])?.['user']);

  if (
    data?.['authority'] !== 'full' ||
    user?.['id'] !== scope.userId ||
    user?.['authVersion'] !== scope.authVersion ||
    row.expires_at.getTime() <= Date.now()
  )
    return undefined;
  const method = data['authenticationMethod'] ?? user['authenticationMethod'];

  return {
    id: createHmac('sha256', scope.secret)
      .update(JSON.stringify(['session-management-v1', scope.userId, row.sid]))
      .digest('base64url'),
    current: row.sid === scope.currentSid,
    startedAt: row.created_at.toISOString(),
    lastActiveAt: row.updated_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    method: method === 'password' || method === 'passkey' || method === 'google' ? method : 'unknown',
  };
}

function resolveExpiry(sess: SessionData): Date {
  const expires: unknown = sess.cookie?.expires;
  const date = expires instanceof Date ? expires : typeof expires === 'string' ? new Date(expires) : undefined;

  return date && Number.isFinite(date.getTime()) ? date : new Date(Date.now() + 7 * 86400000);
}

export class ManagedMemorySessionStore extends Store {
  private readonly leases = new SessionLeases();
  private readonly rows = new Map<string, SessionRow>();
  // Retain tombstones for the store lifetime: an arbitrarily delayed save must never revive a SID.
  private readonly revoked = new Set<string>();

  override get(sid: string, callback: SessionCallback): void {
    const row = this.rows.get(sid);

    if (!row || row.expires_at.getTime() <= Date.now() || this.revoked.has(sid)) {
      this.rows.delete(sid);
      callback(undefined, null);
    } else callback(undefined, JSON.parse(String(row.sess)) as SessionData);
  }

  override set(sid: string, sess: SessionData, callback: (error?: unknown) => void = () => undefined): void {
    if (!this.revoked.has(sid)) {
      const now = new Date();

      this.rows.set(sid, {
        sid,
        sess: JSON.stringify(sess),
        expires_at: resolveExpiry(sess),
        created_at: this.rows.get(sid)?.created_at ?? now,
        updated_at: now,
      });
    }
    callback();
  }

  override touch(sid: string, sess: SessionData, callback: (error?: unknown) => void = () => undefined): void {
    const row = this.rows.get(sid);

    if (row && !this.revoked.has(sid) && row.expires_at.getTime() > Date.now()) {
      row.expires_at = resolveExpiry(sess);
      row.updated_at = new Date();
    }
    callback();
  }

  override destroy(sid: string, callback: (error?: unknown) => void = () => undefined): void {
    void this.leases
      .run([`sid:${sid}`], async () => {
        this.revoked.add(sid);
        this.rows.delete(sid);
      })
      .then(() => callback(), callback);
  }

  override clear(callback: (error?: unknown) => void = () => undefined): void {
    void Promise.all(
      [...this.rows.keys()].map(
        (sid) =>
          new Promise<void>((resolve, reject) => this.destroy(sid, (error) => (error ? reject(error) : resolve()))),
      ),
    ).then(() => callback(), callback);
  }

  override all(callback: (error: unknown, sessions?: Record<string, SessionData>) => void): void {
    const sessions: Record<string, SessionData> = Object.create(null);

    for (const sid of this.rows.keys()) {
      this.get(sid, (_error, data) => {
        if (data) sessions[sid] = data;
      });
    }
    callback(undefined, sessions);
  }

  override length(callback: (error: unknown, length?: number) => void): void {
    this.all((error, sessions) => callback(error, Object.keys(sessions ?? {}).length));
  }

  async listManagedSessions(scope: SessionScope): Promise<ManagedSession[]> {
    const sessions: ManagedSession[] = [];

    for (const row of this.rows.values()) {
      if (row.expires_at.getTime() <= Date.now()) {
        this.rows.delete(row.sid);
        continue;
      }
      const item = managed(row, scope);

      if (item) sessions.push(item);
    }

    return sessions;
  }

  async revokeManagedSessions(scope: SessionScope, id?: string): Promise<number> {
    return this.withSessionAuthority(scope, async () => {
      let count = 0;

      for (const row of this.rows.values()) {
        const item = managed(row, scope);

        if (item && !item.current && (!id || item.id === id)) {
          await new Promise<void>((resolve, reject) =>
            this.destroy(row.sid, (error) => (error ? reject(error) : resolve())),
          );
          count++;
        }
      }

      return count;
    });
  }

  async withSessionAuthority<T>(scope: SessionAuthorityScope, operation: () => Promise<T>): Promise<T> {
    return this.leases.run([`user:${scope.userId}`, `sid:${scope.currentSid}`], async () => {
      const sess = await new Promise<SessionData | null | undefined>((resolve, reject) =>
        this.get(scope.currentSid, (error, data) => (error ? reject(error) : resolve(data))),
      );

      assertSessionAuthority(sess, scope);

      return operation();
    });
  }
}

export class PostgresSessionStore extends Store {
  private readonly ensureTablePromise: Promise<void>;
  private readonly leases: SessionLeases;

  constructor(
    private readonly pool: Pool,
    private readonly tableName = 'user_sessions',
    // Lock waiters must not exhaust the pool used by protected business transactions.
    leasePool: Pick<Pool, 'connect'> = new Pool(pool.options),
  ) {
    super();
    this.leases = new SessionLeases(leasePool);
    this.ensureTablePromise = this.ensureTable();
  }

  override destroy(sid: string, callback: (error?: unknown) => void = () => undefined) {
    void this.ensureTablePromise
      .then(async () => {
        await this.leases.run([`sid:${sid}`], async () =>
          this.pool.query(
            `INSERT INTO ${this.tableName} (sid, sess, expires_at, revoked_at)
          VALUES ($1, '{}'::jsonb, NOW(), NOW()) ON CONFLICT (sid)
          DO UPDATE SET revoked_at = COALESCE(${this.tableName}.revoked_at, NOW()), sess = '{}'::jsonb`,
            [sid],
          ),
        );
        callback();
      })
      .catch((error) => callback(error));
  }

  override get(sid: string, callback: SessionCallback = () => undefined) {
    void this.ensureTablePromise
      .then(async () => {
        const result = await this.pool.query<SessionRow>(
          `SELECT sess, expires_at FROM ${this.tableName} WHERE sid = $1 AND expires_at > NOW() AND revoked_at IS NULL LIMIT 1`,
          [sid],
        );

        const row = result.rows[0];

        if (!row) {
          callback(undefined, null);

          return;
        }

        const payload = typeof row.sess === 'string' ? (JSON.parse(row.sess) as SessionData) : row.sess;

        callback(undefined, payload);
      })
      .catch((error) => callback(error));
  }

  override set(sid: string, sess: SessionData, callback: (error?: unknown) => void = () => undefined) {
    void this.ensureTablePromise
      .then(async () => {
        const expiresAt = resolveExpiry(sess);

        await this.pool.query(
          `
            INSERT INTO ${this.tableName} (sid, sess, expires_at)
            VALUES ($1, $2::jsonb, $3)
            ON CONFLICT (sid)
            DO UPDATE SET sess = EXCLUDED.sess, expires_at = EXCLUDED.expires_at, updated_at = NOW()
            WHERE ${this.tableName}.revoked_at IS NULL
          `,
          [sid, JSON.stringify(sess), expiresAt],
        );
        callback();
      })
      .catch((error) => callback(error));
  }

  override touch(sid: string, sess: SessionData, callback: (error?: unknown) => void = () => undefined) {
    void this.ensureTablePromise
      .then(async () => {
        await this.pool.query(
          `UPDATE ${this.tableName} SET expires_at = $2, updated_at = NOW() WHERE sid = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
          [sid, resolveExpiry(sess)],
        );
        callback();
      })
      .catch((error) => callback(error));
  }

  private async ensureTable() {
    await this.pool.query(
      `SELECT sid, sess, expires_at, created_at, updated_at, revoked_at FROM ${this.tableName} LIMIT 0`,
    );
  }

  private async activeRows(scope: SessionScope) {
    await this.ensureTablePromise;
    const result = await this.pool.query<SessionRow>(
      `SELECT sid, sess, expires_at, created_at, updated_at
      FROM ${this.tableName} WHERE revoked_at IS NULL AND expires_at > NOW()
      AND sess->'passport'->'user'->>'id' = $1
      AND sess->'passport'->'user'->'authVersion' = $2::jsonb AND sess->>'authority' = 'full'`,
      [scope.userId, JSON.stringify(scope.authVersion)],
    );

    return result.rows;
  }

  async listManagedSessions(scope: SessionScope): Promise<ManagedSession[]> {
    return (await this.activeRows(scope)).flatMap((row) => {
      const item = managed(row, scope);

      return item ? [item] : [];
    });
  }

  async revokeManagedSessions(scope: SessionScope, id?: string): Promise<number> {
    return this.withSessionAuthority(scope, async () => {
      const sids = (await this.activeRows(scope))
        .filter((row) => {
          const item = managed(row, scope);

          return item && !item.current && (!id || item.id === id);
        })
        .map((row) => row.sid);

      if (!sids.length) return 0;

      // User lock precedes sorted SID locks; no database row lock is held while acquiring either.
      return this.leases.run(
        sids.sort().map((sid) => `sid:${sid}`),
        async () => {
          const result = await this.pool.query(
            `UPDATE ${this.tableName} SET revoked_at = NOW(), sess = '{}'::jsonb
      WHERE sid = ANY($1::text[]) AND sid <> $2 AND revoked_at IS NULL AND expires_at > NOW()
      AND sess->'passport'->'user'->>'id' = $3
      AND sess->'passport'->'user'->'authVersion' = $4::jsonb AND sess->>'authority' = 'full'`,
            [sids, scope.currentSid, scope.userId, JSON.stringify(scope.authVersion)],
          );

          return result.rowCount ?? 0;
        },
      );
    });
  }

  async withSessionAuthority<T>(scope: SessionAuthorityScope, operation: () => Promise<T>): Promise<T> {
    await this.ensureTablePromise;

    return this.leases.run([`user:${scope.userId}`, `sid:${scope.currentSid}`], async () => {
      const sess = await new Promise<SessionData | null | undefined>((resolve, reject) =>
        this.get(scope.currentSid, (error, data) => (error ? reject(error) : resolve(data))),
      );

      assertSessionAuthority(sess, scope);

      return operation();
    });
  }
}

const globalKey = '__themisSessionStore';

const globalState = globalThis as typeof globalThis & {
  [globalKey]?: session.Store;
};

function createSessionStore(config: SessionConfig, pool?: Pool) {
  if (globalState[globalKey]) {
    return globalState[globalKey] as session.Store;
  }

  const store =
    config.databaseDriver === 'memory' || !pool ? new ManagedMemorySessionStore() : new PostgresSessionStore(pool);

  globalState[globalKey] = store;

  return store;
}

const createSessionMiddleware = (config: SessionConfig, store: session.Store): ReturnType<typeof session> =>
  session({
    cookie: {
      httpOnly: true,
      maxAge: config.sessionMaxAgeMs,
      sameSite: 'lax',
      secure: config.cookieSecure,
    },
    resave: false,
    rolling: true,
    saveUninitialized: false,
    secret: config.sessionSecret,
    store,
  } satisfies SessionOptions);

export { createSessionMiddleware, createSessionStore };
export type { SessionConfig };
