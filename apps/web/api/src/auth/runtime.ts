import { authSchema, type Database } from '@visomi-stack/backend-shared';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestHandler, Request } from 'express';
import session from 'express-session';
import { Passport } from 'passport';
import type { Pool } from 'pg';

import type { AuthConfig } from './config';
import { Passkeys } from './passkeys';
import { SessionStore } from './session-store';

const { credentials } = authSchema;

const initialized = Symbol.for('visomi-stack.authentication.v1');

type InitializedRequest = Request & { [initialized]?: object };
export type AuthRuntime = ReturnType<typeof createAuthentication>;

export function createAuthentication(options: { database: Database; pool: Pool; config: AuthConfig }) {
  const { database, pool, config } = options;
  const passport = new Passport();
  const store = new SessionStore(pool);
  const owner = {};

  passport.serializeUser<Express.User>((user, done) =>
    done(null, {
      id: user.id,
      credentialId: user.credentialId,
      authenticatedAt: user.authenticatedAt,
    }),
  );
  passport.deserializeUser<Express.User>(async (serialized, done) => {
    try {
      if (
        !serialized ||
        typeof serialized.id !== 'string' ||
        typeof serialized.credentialId !== 'string' ||
        typeof serialized.authenticatedAt !== 'number'
      ) {
        done(null, false);

        return;
      }

      const [active] = await database
        .select()
        .from(credentials)
        .where(
          and(
            eq(credentials.id, serialized.credentialId),
            eq(credentials.userId, serialized.id),
            isNull(credentials.revokedAt),
          ),
        );

      done(null, active ? serialized : false);
    } catch {
      done(new Error('authentication_unavailable'));
    }
  });

  const middleware: RequestHandler[] = [
    session({
      store,
      secret: config.secret,
      name: config.cookieName,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, secure: config.secure, sameSite: 'strict', path: '/', maxAge: config.sessionMaxAge },
    }),
    passport.initialize(),
    passport.session(),
    (request: InitializedRequest, _response, next) => {
      request[initialized] = owner;
      next();
    },
  ];
  const requireInitialized: RequestHandler = (request: InitializedRequest, _response, next) => {
    next(
      request[initialized] === owner && request.session && typeof request.logIn === 'function'
        ? undefined
        : new HttpError(503, 'auth_initialization_missing'),
    );
  };

  return { database, config, middleware, requireInitialized, passkeys: new Passkeys(database, config) };
}
