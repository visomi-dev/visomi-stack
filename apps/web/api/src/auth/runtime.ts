import { AuthMail, type MailTransport, type Database } from '@visomi-stack/backend-shared';
import { HttpError } from '@visomi-stack/web-backend-shared';
import type { RequestHandler, Request } from 'express';
import session from 'express-session';
import { Passport } from 'passport';
import type { Pool } from 'pg';

import type { AuthConfig } from './config';
import { readPrincipal, requireFull } from './identity';
import { Google } from './google';
import { Recovery } from './recovery';
import { Devices } from './devices';
import { Accounts } from './accounts';
import { Passkeys } from './passkeys';
import { SessionStore } from './session-store';

const initialized = Symbol.for('visomi-stack.authentication.v1');

type InitializedRequest = Request & { [initialized]?: object };
export type AuthRuntime = ReturnType<typeof createAuthentication>;

export function createAuthentication(options: {
  database: Database;
  pool: Pool;
  config: AuthConfig;
  mail?: MailTransport;
}) {
  const { database, pool, config } = options;
  const passport = new Passport();
  const store = new SessionStore(pool);
  const owner = {};

  passport.serializeUser<Express.User>((user, done) =>
    done(null, {
      id: user.id,
      method: user.method,
      methodId: user.methodId,
      credentialId: user.credentialId,
      authenticatedAt: user.authenticatedAt,
      version: user.version,
      level: user.level,
      secondFactor: user.secondFactor,
      grantId: user.grantId,
    }),
  );
  passport.deserializeUser<Express.User>(async (serialized, done) => {
    try {
      const user = await readPrincipal(database, serialized);

      done(null, user);
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

  const accounts = new Accounts(database, config, new AuthMail(options.mail));

  return {
    database,
    config,
    middleware,
    requireInitialized,
    requireVerifiedSession: ((request, _response, next) => {
      try {
        requireFull(request.user);
        next();
      } catch (error) {
        next(error);
      }
    }) as RequestHandler,
    passkeys: new Passkeys(database, config),
    accounts,
    google: new Google(database, config, accounts.flows),
    recovery: new Recovery(database, config, accounts.flows, accounts.factors),
    devices: new Devices(database, config, accounts.flows),
  };
}
