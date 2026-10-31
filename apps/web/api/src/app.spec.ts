import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import type { Observability } from '@visomi-stack/web-backend-shared';
import { currentObservability, HttpError, httpErrorHandler, httpObservability } from '@visomi-stack/web-backend-shared';
import type { Request, Response } from 'express';
import express, { Router } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app';
import { createAuthRouter } from './auth/router';
import type { AuthRuntime } from './auth/runtime';

vi.mock('@visomi-stack/web-backend-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@visomi-stack/web-backend-shared')>();

  return {
    ...actual,
    currentObservability: vi.fn(),
    httpObservability: vi.fn(() => (_request: unknown, _response: unknown, next: () => void) => next()),
  };
});

vi.mock('./auth/router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth/router')>();

  return { ...actual, createAuthRouter: vi.fn(() => Router()) };
});

function dispatch(
  app: ReturnType<typeof createApp>,
  url: string,
  inspectHeaders?: (headers: ReturnType<ServerResponse['getHeaders']>) => void,
) {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);

  request.method = 'GET';
  request.url = url;

  return new Promise<{ status: number; body: unknown; poweredBy: unknown }>((resolve, reject) => {
    vi.spyOn(response, 'end').mockImplementation((chunk?: unknown) => {
      inspectHeaders?.(response.getHeaders());
      resolve({
        status: response.statusCode,
        body: JSON.parse(String(chunk)),
        poweredBy: response.getHeader('x-powered-by'),
      });

      return response;
    });
    app(request as Request, response as Response, reject);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentObservability).mockReturnValue(undefined);
});

describe('API composition', () => {
  it.each([
    ['/', 200, { message: 'Hello API' }],
    ['/missing', 404, { error: 'not_found' }],
  ])('responds to %s without initializing telemetry or opening a port', async (url, status, body) => {
    const result = await dispatch(createApp(), url as string);

    expect(result).toEqual({ status, body, poweredBy: undefined });
    expect(httpObservability).not.toHaveBeenCalled();
  });

  it('uses explicitly supplied observability ahead of the current process runtime', () => {
    const supplied = {} as Observability;
    const current = {} as Observability;

    vi.mocked(currentObservability).mockReturnValue(current);
    createApp({ observability: supplied });
    expect(httpObservability).toHaveBeenCalledExactlyOnceWith(supplied);
    expect(currentObservability).not.toHaveBeenCalled();
  });

  it('composes with an existing process runtime when none is supplied', () => {
    const current = {} as Observability;

    vi.mocked(currentObservability).mockReturnValue(current);
    createApp();
    expect(httpObservability).toHaveBeenCalledExactlyOnceWith(current);
  });
  it.each([undefined, 'managed', 'inherited'] as const)(
    'respects explicit middleware ownership for %s',
    async (authMode) => {
      const installed = vi.fn((_request, _response, next) => next());
      const requireInitialized = vi.fn((_request, _response, next) => next());
      const auth = {
        middleware: [installed],
        requireInitialized,
        config: {},
        passkeys: {},
        database: {},
      } as unknown as AuthRuntime;
      const result = await dispatch(createApp({ auth, authMode }), '/');

      expect(result.status).toBe(200);
      expect(createAuthRouter).toHaveBeenCalledExactlyOnceWith(auth);
      expect(installed).toHaveBeenCalledTimes(authMode === 'inherited' ? 0 : 1);
    },
  );

  it('fails closed for unconfigured authentication without constructing a database', async () => {
    const result = await dispatch(createApp(), '/auth/session');

    expect(result).toEqual({ status: 503, body: { error: 'authentication_unavailable' }, poweredBy: undefined });
  });
  it('trusts forwarded headers only for explicitly configured proxy addresses', () => {
    expect(createApp().get('trust proxy')).toBe(false);
    expect(createApp({ trustProxy: ['127.0.0.1'] }).get('trust proxy')).toEqual(['127.0.0.1']);
  });

  it.each([undefined, 'managed', 'inherited'] as const)(
    'keeps response ownership explicit for errorMode %s independently of authMode',
    async (errorMode) => {
      const parent = express();
      const errors = vi.fn((error, request, response, next) => httpErrorHandler(error, request, response, next));

      parent.use('/api', createApp({ authMode: 'inherited', errorMode }));
      parent.use(errors);
      const result = await dispatch(parent, '/api/auth/session');

      expect(result.status).toBe(503);
      expect(result.body).toEqual({ error: 'authentication_unavailable' });
      expect(errors).toHaveBeenCalledTimes(errorMode === 'inherited' ? 1 : 0);

      if (errorMode === 'inherited') {
        expect(HttpError.is(errors.mock.calls[0][0])).toBe(true);
      }
    },
  );

  it.each([undefined, 'managed', 'inherited'] as const)(
    'installs Helmet only for managed ownership, helmetMode %s',
    async (helmetMode) => {
      const parent = express();
      const inspect = vi.fn();

      parent.use((_request, response, next) => {
        response.setHeader('Content-Security-Policy', "default-src 'none'");
        next();
      });
      parent.use(createApp({ helmetMode }));
      const result = await dispatch(parent, '/', inspect);
      const headers = inspect.mock.calls[0][0];

      expect(result.status).toBe(200);

      if (helmetMode === 'inherited') {
        expect(headers['content-security-policy']).toBe("default-src 'none'");
        expect(headers['x-content-type-options']).toBeUndefined();
      } else {
        expect(headers['content-security-policy']).toContain("script-src 'self'");
        expect(headers['x-content-type-options']).toBe('nosniff');
      }
    },
  );
});
