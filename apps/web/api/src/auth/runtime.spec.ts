import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import type { Database } from '@visomi-stack/backend-shared';
import express from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { authConfig } from './config';
import { createAuthentication } from './runtime';

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
