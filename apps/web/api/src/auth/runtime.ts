import {
  AuthMail,
  createInjector,
  DATABASE,
  DATABASE_POOL,
  MAIL_TRANSPORT,
  type Database,
  type MailTransport,
} from '@visomi-stack/backend-shared';
import { HttpError } from '@visomi-stack/web-backend-shared';
import type { Request, RequestHandler } from 'express';
import session from 'express-session';
import { Passport } from 'passport';
import type { Pool } from 'pg';

import { Devices } from './devices/service';
import { EmailIdentity } from './email/service';
import { Google } from './google/service';
import { Methods } from './methods/service';
import { Passkeys } from './passkeys/service';
import { Passwords } from './password/service';
import { Recovery } from './recovery/service';
import { Sessions } from './sessions/service';
import { SessionStore } from './sessions/store';
import { AUTH_CONFIG, type AuthConfig } from './shared/config';
import { Flows } from './shared/flows';
import { readPrincipal, requireFull } from './shared/identity';
import { SecurityNotifications } from './shared/notifications';
import { RequestLimitStore } from './shared/request-limit-store';
import { Factors } from './totp/service';

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
  const injector = createInjector([
    { provide: DATABASE, useValue: database },
    { provide: DATABASE_POOL, useValue: pool },
    { provide: AUTH_CONFIG, useValue: config },
    { provide: MAIL_TRANSPORT, useValue: options.mail },
    AuthMail,
    SessionStore,
    Flows,
    Factors,
    Passwords,
    EmailIdentity,
    Sessions,
    Methods,
    SecurityNotifications,
    Passkeys,
    Google,
    Recovery,
    Devices,
    RequestLimitStore,
  ]);
  const store = injector.get<SessionStore>(SessionStore);
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

  return {
    database,
    config,
    middleware,
    requireInitialized,
    requestLimits: injector.get<RequestLimitStore>(RequestLimitStore),
    requireVerifiedSession: ((request, _response, next) => {
      try {
        requireFull(request.user);
        next();
      } catch (error) {
        next(error);
      }
    }) as RequestHandler,
    passkeys: injector.get<Passkeys>(Passkeys),
    password: injector.get<Passwords>(Passwords),
    email: injector.get<EmailIdentity>(EmailIdentity),
    sessions: injector.get<Sessions>(Sessions),
    methods: injector.get<Methods>(Methods),
    notifications: injector.get<SecurityNotifications>(SecurityNotifications),
    flows: injector.get<Flows>(Flows),
    factors: injector.get<Factors>(Factors),
    google: injector.get<Google>(Google),
    recovery: injector.get<Recovery>(Recovery),
    devices: injector.get<Devices>(Devices),
  };
}
