import {
  authSchema,
  DATABASE,
  inject,
  REALTIME_PUBLISHER,
  type Database,
  type RealtimePublisher,
} from '@visomi-stack/backend-shared';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { AUTH_CONFIG, type AuthConfig } from '../shared/config';
import { lockIdentity, requireFull, type Principal } from '../shared/identity';
import { digest } from '../shared/secrets';
import { requireFresh } from '../shared/security';

const { sessions } = authSchema;

export class Sessions {
  private readonly database = inject<Database>(DATABASE);
  private readonly config = inject<AuthConfig>(AUTH_CONFIG);
  private readonly realtime = inject<RealtimePublisher>(REALTIME_PUBLISHER, { optional: true });

  async listSessions(sid: string, current: Express.User) {
    requireFull(current);
    const rows = await this.database
      .select({ sid: sessions.sid, sess: sessions.sess, createdAt: sessions.createdAt, expire: sessions.expire })
      .from(sessions)
      .where(
        and(
          sql`${sessions.sess}->'passport'->'user'->>'id' = ${current.id}`,
          isNull(sessions.revokedAt),
          sql`${sessions.expire} > now()`,
        ),
      );

    return rows.map((row) => ({
      id: this.sessionHandle(row.sid),
      current: row.sid === sid,
      createdAt: row.createdAt,
      expiresAt: row.expire,
      method: (row.sess as { passport?: { user?: Principal } }).passport?.user?.method,
    }));
  }

  async closeSessions(sid: string, current: Express.User, handle?: string) {
    requireFull(current);
    requireFresh(current, this.config);

    const closed = await this.database.transaction(async (tx) => {
      await lockIdentity(tx, sid, current);

      const rows = await tx
        .select({ sid: sessions.sid })
        .from(sessions)
        .where(and(sql`${sessions.sess}->'passport'->'user'->>'id' = ${current.id}`, isNull(sessions.revokedAt)));
      const selected = rows.filter((row) => (handle ? this.sessionHandle(row.sid) === handle : row.sid !== sid));

      if (handle && !selected.length) {
        throw new HttpError(404, 'session_not_found');
      }

      for (const row of selected) {
        await tx
          .update(sessions)
          .set({ revokedAt: new Date(), expire: new Date(0), sess: {} })
          .where(eq(sessions.sid, row.sid));
      }

      return selected;
    });

    for (const row of closed) {
      void this.realtime?.notifySession(row.sid).catch(() => undefined);
    }

    return closed.some((row) => row.sid === sid);
  }

  private sessionHandle(sid: string) {
    // Public handles cannot be replayed as session cookies.
    return digest(this.config.secret, 'session-handle', sid);
  }
}
