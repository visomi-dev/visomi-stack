import {
  AuthMail,
  createInjector,
  DATABASE,
  DATABASE_POOL,
  type Database,
  type Provider,
  type Type,
} from '@visomi-stack/backend-shared';
import type { Pool } from 'pg';

import { DevicesController } from '../../src/auth/devices/controller';
import { Devices } from '../../src/auth/devices/service';
import { EmailController } from '../../src/auth/email/controller';
import { EmailIdentity } from '../../src/auth/email/service';
import { GoogleController } from '../../src/auth/google/controller';
import { Google } from '../../src/auth/google/service';
import { MethodsController } from '../../src/auth/methods/controller';
import { Methods } from '../../src/auth/methods/service';
import { PasskeysController } from '../../src/auth/passkeys/controller';
import { Passkeys } from '../../src/auth/passkeys/service';
import { PasswordController } from '../../src/auth/password/controller';
import { Passwords } from '../../src/auth/password/service';
import { RecoveryController } from '../../src/auth/recovery/controller';
import { Recovery } from '../../src/auth/recovery/service';
import { SessionsController } from '../../src/auth/sessions/controller';
import { SessionResponses } from '../../src/auth/sessions/response';
import { Sessions } from '../../src/auth/sessions/service';
import { SessionStore } from '../../src/auth/sessions/store';
import { AUTH_CONFIG, type AuthConfig } from '../../src/auth/shared/config';
import { Flows } from '../../src/auth/shared/flows';
import { SecurityNotifications } from '../../src/auth/shared/notifications';
import { RequestLimitStore } from '../../src/auth/shared/request-limit-store';
import { TotpController } from '../../src/auth/totp/controller';
import { Factors } from '../../src/auth/totp/service';

export function authInjector(database: Database, config: AuthConfig, overrides: Provider[] = []) {
  return createInjector([
    { provide: DATABASE, useValue: database },
    { provide: AUTH_CONFIG, useValue: config },
    AuthMail,
    Passwords,
    EmailIdentity,
    Sessions,
    Methods,
    SecurityNotifications,
    Factors,
    Flows,
    Google,
    Recovery,
    Devices,
    Passkeys,
    RequestLimitStore,
    SessionResponses,
    DevicesController,
    EmailController,
    GoogleController,
    MethodsController,
    PasskeysController,
    PasswordController,
    RecoveryController,
    SessionsController,
    TotpController,

    ...overrides,
  ]);
}

export function authService<T>(
  service: Type<T>,
  database: Database,
  config: AuthConfig,
  overrides: Provider[] = [],
): T {
  return authInjector(database, config, overrides).get<T>(service);
}

export function sessionStore(pool: Pool): SessionStore {
  return createInjector([SessionStore, { provide: DATABASE_POOL, useValue: pool }]).get<SessionStore>(SessionStore);
}
