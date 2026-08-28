import session, { MemoryStore, Store, type SessionData, type SessionOptions } from 'express-session';
import type { Pool } from 'pg';

type SessionConfig = {
  cookieSecure: boolean;
  databaseDriver: 'memory' | 'pg';
  sessionMaxAgeMs: number;
  sessionSecret: string;
};

type SessionCallback = (error?: unknown, session?: SessionData | null) => void;

type SessionRow = {
  expires_at: Date;
  sess: SessionData | string;
};

class PostgresSessionStore extends Store {
  private readonly ensureTablePromise: Promise<void>;

  constructor(
    private readonly pool: Pool,
    private readonly tableName = 'user_sessions',
  ) {
    super();
    this.ensureTablePromise = this.ensureTable();
  }

  override destroy(sid: string, callback: (error?: unknown) => void = () => undefined) {
    void this.ensureTablePromise
      .then(async () => {
        await this.pool.query(`DELETE FROM ${this.tableName} WHERE sid = $1`, [sid]);
        callback();
      })
      .catch((error) => callback(error));
  }

  override get(sid: string, callback: SessionCallback = () => undefined) {
    void this.ensureTablePromise
      .then(async () => {
        const result = await this.pool.query<SessionRow>(
          `SELECT sess, expires_at FROM ${this.tableName} WHERE sid = $1 AND expires_at > NOW() LIMIT 1`,
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
        const expiresAt = this.resolveExpiry(sess);

        await this.pool.query(
          `
            INSERT INTO ${this.tableName} (sid, sess, expires_at)
            VALUES ($1, $2::jsonb, $3)
            ON CONFLICT (sid)
            DO UPDATE SET sess = EXCLUDED.sess, expires_at = EXCLUDED.expires_at, updated_at = NOW()
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
        await this.pool.query(`UPDATE ${this.tableName} SET expires_at = $2, updated_at = NOW() WHERE sid = $1`, [
          sid,
          this.resolveExpiry(sess),
        ]);
        callback();
      })
      .catch((error) => callback(error));
  }

  private async ensureTable() {
    await this.pool.query(`SELECT sid, sess, expires_at, created_at, updated_at FROM ${this.tableName} LIMIT 0`);
  }

  private resolveExpiry(sess: SessionData) {
    const expires = sess.cookie?.expires;

    if (expires instanceof Date) {
      return expires;
    }

    return new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
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

  const store = config.databaseDriver === 'memory' || !pool ? new MemoryStore() : new PostgresSessionStore(pool);

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
