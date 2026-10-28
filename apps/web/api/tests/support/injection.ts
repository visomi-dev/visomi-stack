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

import { Devices } from '../../src/auth/devices/service';
import { EmailIdentity } from '../../src/auth/email/service';
import { Google } from '../../src/auth/google/service';
import { Methods } from '../../src/auth/methods/service';
import { Passkeys } from '../../src/auth/passkeys/service';
import { Passwords } from '../../src/auth/password/service';
import { Recovery } from '../../src/auth/recovery/service';
import { Sessions } from '../../src/auth/sessions/service';
import { SessionStore } from '../../src/auth/sessions/store';
import { AUTH_CONFIG, type AuthConfig } from '../../src/auth/shared/config';
import { Flows } from '../../src/auth/shared/flows';
import { SecurityNotifications } from '../../src/auth/shared/notifications';
import { RequestLimitStore } from '../../src/auth/shared/request-limit-store';
import { Factors } from '../../src/auth/totp/service';

export function authService<T>(
  service: Type<T>,
  database: Database,
  config: AuthConfig,
  overrides: Provider[] = [],
): T {
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
    ...overrides,
  ]).get<T>(service);
}

export function sessionStore(pool: Pool): SessionStore {
  return createInjector([SessionStore, { provide: DATABASE_POOL, useValue: pool }]).get<SessionStore>(SessionStore);
}
