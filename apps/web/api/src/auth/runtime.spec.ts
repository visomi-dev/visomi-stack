import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import type { Database } from '@visomi-stack/backend-shared';
import express from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { Passport } from 'passport';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { authConfig } from './config';
import { createAuthentication } from './runtime';

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const pool = { query: vi.fn(), end: vi.fn() } as unknown as Pool;
  const database = { select: vi.fn() } as unknown as Database;
  const runtime = createAuthentication({
    pool,
    database,
    config: authConfig({
      origin: 'http://localhost',
      rpId: 'localhost',
      secret: 'synthetic-session-secret-with-32-bytes',
    }),
  });

  return { runtime, pool, database };
}

async function initializedRequest(first: ReturnType<typeof fixture>, second = first) {
  const app = express();

  app.use(first.runtime.middleware);
  app.use(second.runtime.requireInitialized);
  app.get('/', (request, response) => response.json({ anonymous: !request.isAuthenticated() }));
  app.use((error: { code: string; status: number }, _request: Request, response: Response, _next: unknown) => {
    response.status(error.status).json({ error: error.code });
  });
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);

  request.method = 'GET';
  request.url = '/';

  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    vi.spyOn(response, 'end').mockImplementation((chunk?: unknown) => {
      resolve({ status: response.statusCode, body: JSON.parse(String(chunk)) });

      return response;
    });
    app(request as Request, response as Response, reject);
  });
}

describe('explicit session and Passport initialization', () => {
  it('creates an isolated service graph for every runtime', () => {
    const first = fixture();
    const second = fixture();

    expect(first.runtime.accounts).not.toBe(second.runtime.accounts);
    expect(first.runtime.accounts.flows).not.toBe(second.runtime.accounts.flows);
    expect(first.runtime.accounts.factors).not.toBe(second.runtime.accounts.factors);
    expect(first.runtime.passkeys).not.toBe(second.runtime.passkeys);
    expect(first.runtime.google).not.toBe(second.runtime.google);
    expect(first.pool.query).not.toHaveBeenCalled();
    expect(second.pool.query).not.toHaveBeenCalled();
  });

  it('serializes only the authentication identity and timestamp', () => {
    const serialize = vi.spyOn(Passport.prototype, 'serializeUser');

    fixture();
    const callback = serialize.mock.calls[0][0] as (user: Express.User, done: (...args: unknown[]) => void) => void;
    const done = vi.fn();
    const user = {
      id: 'synthetic-user',
      credentialId: 'synthetic-credential',
      authenticatedAt: 123,
      privateField: 'SYNTHETIC_PRIVATE',
    };

    callback(user, done);
    expect(done).toHaveBeenCalledExactlyOnceWith(null, {
      id: user.id,
      credentialId: user.credentialId,
      authenticatedAt: 123,
    });
  });

  it.each([null, {}, { id: 'synthetic' }, { id: 'synthetic', credentialId: 'synthetic' }])(
    'rejects malformed serialized identities before querying storage',
    async (serialized) => {
      const deserialize = vi.spyOn(Passport.prototype, 'deserializeUser');
      const f = fixture();
      const callback = deserialize.mock.calls[0][0] as (
        user: unknown,
        done: (...args: unknown[]) => void,
      ) => Promise<void>;
      const done = vi.fn();

      await callback(serialized, done);
      expect(done).toHaveBeenCalledExactlyOnceWith(null, false);
      expect(f.database.select).not.toHaveBeenCalled();
    },
  );

  it.each(['active', 'revoked', 'unavailable'])(
    'deserializes %s credentials without exposing database failures',
    async (state) => {
      const deserialize = vi.spyOn(Passport.prototype, 'deserializeUser');
      const f = fixture();
      const where = vi.fn();

      vi.mocked(f.database.select).mockReturnValue({ from: () => ({ where }) } as never);
      if (state === 'unavailable') {
        where.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_DATABASE_ERROR'));
      } else {
        where
          .mockResolvedValueOnce([
            { id: 'synthetic-user', authVersion: 1, email: 'synthetic@example.test', emailVerifiedAt: new Date() },
          ])
          .mockResolvedValueOnce(state === 'active' ? [{ id: 'synthetic-credential' }] : []);
      }

      const callback = deserialize.mock.calls[0][0] as (
        user: unknown,
        done: (...args: unknown[]) => void,
      ) => Promise<void>;
      const done = vi.fn();
      const user = {
        id: 'synthetic-user',
        credentialId: 'synthetic-credential',
        method: 'passkey',
        methodId: 'synthetic-credential',
        version: 1,
        level: 'full',
        email: 'synthetic@example.test',
        emailVerified: true,
        authenticatedAt: 123,
      };

      await callback(user, done);
      if (state === 'unavailable') {
        expect(done).toHaveBeenCalledExactlyOnceWith(new Error('authentication_unavailable'));
      } else {
        expect(done).toHaveBeenCalledExactlyOnceWith(null, state === 'active' ? user : false);
      }
    },
  );
  it('does not open a connection, migrate or close caller-owned resources during composition', () => {
    const f = fixture();

    expect(f.pool.query).not.toHaveBeenCalled();
    expect(f.pool.end).not.toHaveBeenCalled();
    expect(f.database.select).not.toHaveBeenCalled();
  });

  it('rejects inherited requests that merely have req.user or session-looking fields', () => {
    const f = fixture();
    const next = vi.fn();

    f.runtime.requireInitialized(
      { user: { id: 'synthetic' }, session: {}, logIn: vi.fn() } as unknown as Request,
      {} as Response,
      next,
    );
    expect(next.mock.calls[0][0]).toMatchObject({ code: 'auth_initialization_missing', status: 503 });
  });

  it('accepts legitimate anonymous requests after the full explicit chain completes', async () => {
    const f = fixture();
    const result = await initializedRequest(f);

    expect(result).toEqual({ status: 200, body: { anonymous: true } });
    expect(f.pool.query).not.toHaveBeenCalled();
  });

  it('rejects a chain installed by a different runtime instance', async () => {
    const result = await initializedRequest(fixture(), fixture());

    expect(result).toEqual({ status: 503, body: { error: 'auth_initialization_missing' } });
  });
});

it('exposes a full-session guard that rejects anonymous and unverified sessions', () => {
  const runtime = fixture().runtime;
  const full = {
    id: 'synthetic',
    version: 1,
    authenticatedAt: Date.now(),
    method: 'password' as const,
    level: 'full' as const,
    emailVerified: true,
  };

  for (const user of [undefined, { ...full, level: 'unverified' as const }, full]) {
    const next = vi.fn();

    runtime.requireVerifiedSession({ user } as Request, {} as Response, next);
    if (user?.level === 'full') {
      expect(next).toHaveBeenCalledWith();
    } else {
      expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    }
  }
});
