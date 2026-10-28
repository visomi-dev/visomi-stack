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

import { Accounts } from '../../src/auth/accounts';
import { AUTH_CONFIG, type AuthConfig } from '../../src/auth/config';
import { Devices } from '../../src/auth/devices';
import { Factors } from '../../src/auth/factors';
import { Flows } from '../../src/auth/flows';
import { Google } from '../../src/auth/google';
import { Passkeys } from '../../src/auth/passkeys';
import { Recovery } from '../../src/auth/recovery';
import { RequestLimitStore } from '../../src/auth/request-limit-store';
import { SessionStore } from '../../src/auth/session-store';

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
    Accounts,
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
