import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { AuthHttpError, HttpError, httpErrorHandler, initializeObservability } from '@visomi-stack/web-backend-shared';
import type { Request, RequestHandler, Response } from 'express';
import express, { Router } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { ApiModule, EmbeddedAuthentication } from './api-module';
import { createGatewayApp } from './app';

function dispatch(
  app: ReturnType<typeof createGatewayApp>,
  path: string,
  inspectHeaders?: (headers: ReturnType<ServerResponse['getHeaders']>) => void,
) {
  const request = new IncomingMessage(new Socket()) as Request;
  const response = new ServerResponse(request);

  request.method = 'GET';
  request.url = path;

  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    vi.spyOn(response, 'end').mockImplementation((chunk?: unknown) => {
      inspectHeaders?.(response.getHeaders());
      Object.defineProperty(response, 'writableFinished', { value: true });
      response.emit('finish');
      resolve({ status: response.statusCode, body: chunk ? JSON.parse(String(chunk)) : undefined });

      return response;
    });
    app(request, response as Response, reject);
  });
}

function apiFixture(handler: RequestHandler = (request, response) => response.json({ path: request.path })) {
  return { createApp: vi.fn(() => handler), authConfig: vi.fn(), createAuthentication: vi.fn() } satisfies ApiModule;
}

describe('gateway composition', () => {
  it('serves a silent disabled configuration without entering authentication', async () => {
    const authenticate = vi.fn<RequestHandler>();
    const inspect = vi.fn();
    const result = await dispatch(
      createGatewayApp({
        api: apiFixture(),
        auth: {
          middleware: [authenticate],
        } as EmbeddedAuthentication,
      }),
      '/telemetry/config',
      inspect,
    );

    expect(result).toEqual({ status: 200, body: { enabled: false } });
    expect(inspect.mock.calls[0][0]['cache-control']).toBe('no-store');
    expect(authenticate).not.toHaveBeenCalled();
  });
  it.each(['/main.js.map', '/main.js%2Emap'])('keeps source maps private for %s', async (path) => {
    const handler = vi.fn<RequestHandler>();
    const result = await dispatch(
      createGatewayApp({
        api: apiFixture(),
        site: {
          handler,
          clientDirectory: '/synthetic/client',
        },
      }),
      path,
    );

    expect(result).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('mounts browser intake before the API', async () => {
    const context = vi.fn<RequestHandler>((_request, _response, next) => next());
    const router = Router();

    router.get('/config', (_request, response) => response.json({ enabled: true }));
    const result = await dispatch(
      createGatewayApp({ api: apiFixture(), browserTelemetry: { context, router } }),
      '/telemetry/config',
    );

    expect(result).toEqual({ status: 200, body: { enabled: true } });
    expect(context).toHaveBeenCalledOnce();
  });
  it('mounts public middleware after reserved routes and sanitizes its failures', async () => {
    const handler = vi.fn<RequestHandler>((_request, response) => response.json({ page: 'synthetic_site' }));
    const site = { handler, clientDirectory: '/synthetic/missing/client' };
    const api = apiFixture((_request, _response, next) => next());
    const app = createGatewayApp({ api, site });

    for (const path of ['/api/missing', '/app', '/app/es/missing']) {
      const result = await dispatch(app, path);

      expect(result).toEqual({ status: 404, body: { error: 'not_found' } });
    }
    expect(handler).not.toHaveBeenCalled();
    const rendered = await dispatch(app, '/en/');

    expect(rendered).toEqual({ status: 200, body: { page: 'synthetic_site' } });
    handler.mockImplementation((_request, _response, next) => next(new Error('synthetic_private_site_error')));
    const failed = await dispatch(app, '/es/');

    expect(failed).toEqual({ status: 500, body: { error: 'internal_error' } });
  });
  it('uses the supplied observability runtime for HTTP completion and forwards it to the API', async () => {
    const lines: string[] = [];
    const telemetry = initializeObservability({
      service: 'web-gateway',
      version: '0.0.1',
      destination: { write: (line) => lines.push(line) },
    });
    const api = apiFixture();

    try {
      await dispatch(createGatewayApp({ api, observability: telemetry }), '/api/');

      expect(lines.map((line) => JSON.parse(line))).toEqual([
        expect.objectContaining({ event: 'http.request', outcome: 'success', status: 200 }),
      ]);
      expect(api.createApp).toHaveBeenCalledWith(expect.objectContaining({ observability: telemetry }));
    } finally {
      await telemetry.shutdown();
    }
  });
  it('mounts the injected API under /api without listening or installing authentication twice', async () => {
    const api = apiFixture((request, response) =>
      response.json({ path: request.path, initialized: response.locals.initialized }),
    );
    const authenticate = vi.fn((_request: Request, response: Response, next: () => void) => {
      response.locals.initialized = true;
      next();
    });
    const auth = { middleware: [authenticate] };
    const app = createGatewayApp({ api, auth });
    const result = await dispatch(app, '/api/auth/session');

    expect(result).toEqual({ status: 200, body: { path: '/auth/session', initialized: true } });
    expect(authenticate).toHaveBeenCalledOnce();
    expect(api.createApp).toHaveBeenCalledExactlyOnceWith({
      basePath: '/api',
      authMode: 'inherited',
      errorMode: 'inherited',
      helmetMode: 'inherited',
      auth,
      observability: undefined,
    });
    expect(api.createAuthentication).not.toHaveBeenCalled();
  });

  it('leaves missing authentication to the API boundary and returns fixed 404s elsewhere', async () => {
    const api = apiFixture();
    const app = createGatewayApp({ api });

    const missing = await dispatch(app, '/');
    const mounted = await dispatch(app, '/api/');

    expect(missing).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(mounted).toEqual({ status: 200, body: { path: '/' } });
    expect(api.createApp).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined, authMode: 'inherited' }));
  });

  it('sets proxy trust only from explicit configuration', () => {
    expect(createGatewayApp({ api: apiFixture() }).get('trust proxy')).toBe(false);
    expect(createGatewayApp({ api: apiFixture(), trustProxy: ['127.0.0.1'] }).get('trust proxy')).toEqual([
      '127.0.0.1',
    ]);
  });

  it('sanitizes failures from the mounted API', async () => {
    const api = apiFixture((_request, _response, next) => next(new Error('SYNTHETIC_PRIVATE_FAILURE')));

    const result = await dispatch(createGatewayApp({ api }), '/api/');

    expect(result).toEqual({
      status: 500,
      body: { error: 'internal_error' },
    });
  });

  it.each([
    new HttpError(422, 'request_invalid', 'Check the supplied fields.', { fields: ['label'] }),
    new AuthHttpError(401, 'authentication_required'),
    new AuthHttpError(403, 'access_denied'),
  ])('handles explicit public errors delegated by the API', async (error) => {
    const api = apiFixture((_request, _response, next) => next(error));
    const result = await dispatch(createGatewayApp({ api }), '/api/');

    expect(result).toEqual({
      status: error.status,
      body: {
        error: error.code,
        ...(error.publicMessage === undefined ? {} : { message: error.publicMessage }),
        ...(error.body === undefined ? {} : { body: error.body }),
      },
    });
  });

  it('handles errors raised before the API in the host authentication chain', async () => {
    const error = new AuthHttpError(403, 'access_denied');
    const auth = { middleware: [(_request, _response, next) => next(error)] } as EmbeddedAuthentication;
    const api = apiFixture();
    const result = await dispatch(createGatewayApp({ api, auth }), '/api/');

    expect(result).toEqual({ status: 403, body: { error: 'access_denied' } });
  });

  it.each([undefined, 'managed', 'inherited'] as const)(
    'respects gateway Helmet ownership for %s',
    async (helmetMode) => {
      const inspect = vi.fn();

      await dispatch(createGatewayApp({ api: apiFixture(), helmetMode }), '/', inspect);

      const headers = inspect.mock.calls[0][0];

      expect(headers['x-content-type-options']).toBe(helmetMode === 'inherited' ? undefined : 'nosniff');
    },
  );

  it('delegates errors and preserves policy when a parent owns both concerns', async () => {
    const parent = express();
    const inspect = vi.fn();
    const error = new HttpError(422, 'request_invalid', 'Check the supplied fields.');
    const api = apiFixture((_request, _response, next) => next(error));
    const errors = vi.fn((error, request, response, next) => httpErrorHandler(error, request, response, next));

    parent.use((_request, response, next) => {
      response.setHeader('Content-Security-Policy', "default-src 'none'");
      next();
    });
    parent.use(createGatewayApp({ api, errorMode: 'inherited', helmetMode: 'inherited' }));
    parent.use(errors);
    const result = await dispatch(parent, '/api/', inspect);

    expect(result).toEqual({ status: 422, body: { error: 'request_invalid', message: 'Check the supplied fields.' } });
    expect(errors).toHaveBeenCalledOnce();
    expect(errors.mock.calls[0][0]).toBe(error);
    expect(inspect.mock.calls[0][0]['content-security-policy']).toBe("default-src 'none'");
  });
});
