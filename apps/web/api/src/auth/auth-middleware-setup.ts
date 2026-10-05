import { resolve } from 'node:path';

import type { PGlite } from '@electric-sql/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { PgliteDatabase } from 'drizzle-orm/pglite';

import { resetPasskeySecurityState } from './passkey-security';
import { verifyTotpCode } from './totp';
import { store } from './auth-middleware-fixture';

import { db } from 'shared';

jest.mock('shared', () => {
  const actual = jest.requireActual('shared');
  const { PGlite } = jest.requireActual('@electric-sql/pglite');
  const { drizzle } = jest.requireActual('drizzle-orm/pglite');

  return {
    ...actual,
    db: drizzle(new PGlite(), { casing: 'snake_case' }),
    env: {
      ...actual.env,
      DATABASE_DRIVER: 'memory',
      MAIL_TRANSPORT: 'memory',
      AUTH_TOTP_ENROLLMENT_ENABLED: true,
      OPAQUE_SYNC_STORAGE: 'memory',
    },
  };
});

jest.mock('../shared/env', () => {
  const actual = jest.requireActual('../shared/env');

  return {
    ...actual,
    env: {
      ...actual.env,
      DATABASE_DRIVER: 'memory',
      MAIL_TRANSPORT: 'memory',
      OPAQUE_SYNC_STORAGE: 'memory',
      AUTH_TOTP_ENROLLMENT_ENABLED: true,
    },
  };
});

jest.mock('./totp', () => ({
  decryptTotpSecret: jest.fn(() => 'test-secret'),
  verifyTotpCode: jest.fn(async (_secret: string, code: string) => code === '123456'),
  totpTimeStep: () => 1,
  generateTotpSecret: () => 'new-secret',
  encryptTotpSecret: () => 'encrypted-secret',
}));

beforeAll(async () => {
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) => store.clear((error) => (error ? reject(error) : resolve())));
  await (db as unknown as { $client: PGlite }).$client.close();
});

beforeEach(() => {
  resetPasskeySecurityState();
  jest.mocked(verifyTotpCode).mockClear();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => store.clear((error) => (error ? reject(error) : resolve())));
  store.removeAllListeners();
});
