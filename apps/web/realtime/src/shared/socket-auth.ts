import type { IncomingMessage, ServerResponse } from 'node:http';

import { createSessionMiddleware, createSessionStore, env, getPool } from 'shared';

function createRealtimeSessionMiddleware() {
  const sessionConfig = {
    cookieSecure: env.COOKIE_SECURE,
    databaseDriver: env.DATABASE_DRIVER,
    sessionMaxAgeMs: env.SESSION_MAX_AGE_MS,
    sessionSecret: env.SESSION_SECRET,
  };

  const store = createSessionStore(sessionConfig, env.DATABASE_DRIVER === 'pg' ? getPool() : undefined);

  return createSessionMiddleware(sessionConfig, store);
}

function bindSocketSession(engine: {
  use: (handler: (req: IncomingMessage, res: ServerResponse, next: (error?: Error) => void) => void) => void;
}) {
  const sessionMiddleware = createRealtimeSessionMiddleware();

  engine.use((req, res, next) => sessionMiddleware(req as never, res as never, next as never));
}

export { bindSocketSession };
