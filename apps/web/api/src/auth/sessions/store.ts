import { DATABASE_POOL, inject } from '@visomi-stack/backend-shared';
import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import type { Pool } from 'pg';

const PgStore = connectPgSimple(session);

// Keep the established store's get/set/touch behavior; the database trigger rejects stale writes.
export class SessionStore extends PgStore {
  private readonly pool: Pool;

  constructor() {
    const pool = inject<Pool>(DATABASE_POOL);

    super({
      pool,
      tableName: 'auth_sessions',
      createTableIfMissing: false,
      pruneSessionInterval: false,
      errorLog: () => undefined,
    });
    this.pool = pool;
  }

  override destroy(sid: string, callback: (error?: Error) => void = () => undefined): void {
    void this.pool
      .query(
        `INSERT INTO auth_sessions (sid, sess, expire, revoked_at)
      VALUES ($1, '{}'::jsonb, to_timestamp(0), now())
      ON CONFLICT (sid) DO UPDATE SET sess = '{}'::jsonb, expire = to_timestamp(0), revoked_at = now()
      WHERE auth_sessions.revoked_at IS NULL RETURNING sid`,
        [sid],
      )
      .then(
        (result) => callback(result.rowCount ? undefined : new Error('session_revoked')),
        () => callback(new Error('session_store_unavailable')),
      );
  }
}
