import passport from 'passport';
import type { RequestHandler } from 'express';

import { env } from '../env';
import { getPool } from '../db/pool';
import { createSessionMiddleware, createSessionStore } from '../session';
import { revokeSessionPushSubscriptions } from '../notifications/subscriptions';
import { revokeSessionVaultCustody } from '../crypto/vault-session-cleanup';

function createAuthRuntimeMiddleware(): RequestHandler[] {
  const sessionConfig = {
    cookieSecure: env.COOKIE_SECURE,
    databaseDriver: env.DATABASE_DRIVER,
    sessionMaxAgeMs: env.SESSION_MAX_AGE_MS,
    sessionSecret: env.SESSION_SECRET,
    onSessionRevoked: async (sid: string) => {
      await revokeSessionPushSubscriptions(sid);
      await revokeSessionVaultCustody(sid);
    },
  };

  const sessionStore = createSessionStore(sessionConfig, env.DATABASE_DRIVER === 'pg' ? getPool() : undefined);

  return [createSessionMiddleware(sessionConfig, sessionStore), passport.initialize(), passport.session()];
}

export { createAuthRuntimeMiddleware };
