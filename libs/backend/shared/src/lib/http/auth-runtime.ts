import passport from 'passport';
import type { RequestHandler } from 'express';

import { env } from '../env';
import { getPool } from '../db/pool';
import { createSessionMiddleware, createSessionStore } from '../session';

function createAuthRuntimeMiddleware(): RequestHandler[] {
  const sessionConfig = {
    cookieSecure: env.COOKIE_SECURE,
    databaseDriver: env.DATABASE_DRIVER,
    sessionMaxAgeMs: env.SESSION_MAX_AGE_MS,
    sessionSecret: env.SESSION_SECRET,
  };

  const sessionStore = createSessionStore(sessionConfig, env.DATABASE_DRIVER === 'pg' ? getPool() : undefined);

  return [createSessionMiddleware(sessionConfig, sessionStore), passport.initialize(), passport.session()];
}

export { createAuthRuntimeMiddleware };
