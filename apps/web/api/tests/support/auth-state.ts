import { AuthMail, type Database, createInjector, MAIL_TRANSPORT } from '@visomi-stack/backend-shared';
import { vi } from 'vitest';

import { authConfig } from '../../src/auth/config';
import { type Flow } from '../../src/auth/flows';
import { principal, type Principal, type Transaction, type User } from '../../src/auth/identity';
import { encryptSecret, totpSetup } from '../../src/auth/secrets';
export function storage(results: unknown[] = []) {
  const run = vi.fn(async () => {
    const next = results.shift();

    if (next instanceof Error) {
      throw next;
    }

    return next ?? [];
  });
  const query = () => {
    const chain: Record<string, unknown> = {
      then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => run().then(resolve, reject),
    };

    for (const name of ['from', 'where', 'for', 'orderBy', 'values', 'set', 'returning', 'onConflictDoUpdate']) {
      chain[name] = () => chain;
    }

    return chain;
  };
  const db = {
    select: query,
    insert: query,
    update: query,
    delete: query,
    execute: query,
    transaction: async (callback: (tx: unknown) => unknown) => callback(db),
  } as unknown as Database;

  return { db, tx: db as unknown as Transaction, run };
}

export const config = authConfig({
  origin: 'http://localhost',
  rpId: 'localhost',
  secret: 'synthetic-session-secret-more-than-32-bytes',
  totpKey: Buffer.alloc(32, 7).toString('base64url'),
});

export const user: User = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'synthetic@example.test',
  emailVerifiedAt: new Date(),
  passwordHash: 'synthetic',
  authVersion: 1,
  createdAt: new Date(),
};

export const current = principal(user, 'password');

export const session = { sid: 'synthetic-session' };

export const flow: Flow = {
  id: '22222222-2222-4222-8222-222222222222',
  sessionId: session.sid,
  userId: user.id,
  authVersion: 1,
  purpose: 'enrollment',
  email: user.email,
  codeHash: null,
  data: { factorProven: true },
  attempts: 0,
  createdAt: new Date(),
  lastSentAt: null,
  expiresAt: new Date(Date.now() + 600000),
  consumedAt: null,
};

export const granted: Principal = { ...principal(user, 'recovery', flow.id, 'recovery'), grantId: flow.id };

export const factor = {
  id: 'synthetic-factor',
  userId: user.id,
  encryptedSecret: encryptSecret(totpSetup(user.email!).secret, config.totpKey!),
  lastStep: -1,
  status: 'active',
};

export const quietMail = createInjector([
  AuthMail,
  {
    provide: MAIL_TRANSPORT,
    useValue: {
      async send() {
        return undefined;
      },
      close() {
        return undefined;
      },
    },
  },
]).get<AuthMail>(AuthMail);
