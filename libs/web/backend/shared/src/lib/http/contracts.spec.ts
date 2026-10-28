import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import express, { json, type Request, type Response } from 'express';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

import type { RouteContract } from './contracts';
import { createApiDocument, defineRoute, registerRoute, registerRoutes } from './contracts';
import { httpErrorHandler } from './http-error-handler';

function dispatch(app: ReturnType<typeof express>, path = '/example', value?: unknown, method = 'POST') {
  const request = new IncomingMessage(new Socket()) as Request;
  const response = new ServerResponse(request);
  const text = value === undefined ? undefined : JSON.stringify(value);

  request.method = method;
  request.url = path;
  request.headers = { 'x-synthetic-proof': '7' };
  if (text !== undefined) {
    request.headers['content-type'] = 'application/json';
    request.headers['content-length'] = String(Buffer.byteLength(text));
  }

  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    vi.spyOn(response, 'end').mockImplementation((chunk?: unknown) => {
      resolve({ status: response.statusCode, body: chunk ? JSON.parse(String(chunk)) : undefined });

      return response;
    });
    app(request, response as Response, reject);
    if (text !== undefined) {
      request.push(text);
    }

    request.push(null);
  });
}

const contract = defineRoute({
  method: 'post',
  path: '/example/:id',
  operationId: 'example',
  summary: 'Synthetic contract',
  tags: ['test'],
  description: 'Input and output types differ intentionally.',
  security: [],
  validationErrors: {
    email_invalid: { status: 400, code: 'email_invalid' },
    password_policy: { status: 400, code: 'password_policy' },
    intent_invalid: { status: 403, code: 'intent_invalid' },
    synthetic_unauthorized: { status: 401, code: 'synthetic_unauthorized' },
  },
  request: z.object({
    body: z.strictObject({ count: z.string().transform(Number), label: z.string().trim() }),
    params: z.object({ id: z.string() }),
    query: z.object({ page: z.coerce.number() }),
    headers: z.object({ 'x-synthetic-proof': z.coerce.number() }),
  }),
  responses: {
    200: {
      description: 'Parsed result.',
      content: { 'application/json': { schema: z.object({ count: z.number(), label: z.string() }) } },
    },
  },
});

function document(contracts: readonly RouteContract[] = [contract], basePath = '/') {
  return createApiDocument({ title: 'Synthetic API', version: '1', basePath, contracts });
}

describe('typed HTTP route contracts', () => {
  it('delivers parsed body, path, query and headers to the handler with inferred output types', async () => {
    expectTypeOf<z.input<typeof contract.request>['body']['count']>().toEqualTypeOf<string>();
    expectTypeOf<z.output<typeof contract.request>['body']['count']>().not.toBeAny();
    expectTypeOf<z.output<typeof contract.request>['body']['count']>().toEqualTypeOf<number>();
    expectTypeOf<z.output<typeof contract.request>['params']['id']>().toEqualTypeOf<string>();
    const app = express();
    const guard = vi.fn((_request, _response, next) => next());

    app.use(json());
    registerRoute(
      app,
      contract,
      (request, response, input) => {
        expectTypeOf(input.body.count).toEqualTypeOf<number>();
        expect(request.body.count).toBe('4');
        response.json(input);
      },
      guard,
    );
    app.use(httpErrorHandler);
    const result = await dispatch(app, '/example/synthetic?page=2', { count: '4', label: '  Parsed  ' });

    expect(result).toEqual({
      status: 200,
      body: {
        body: { count: 4, label: 'Parsed' },
        params: { id: 'synthetic' },
        query: { page: 2 },
        headers: { 'x-synthetic-proof': 7 },
      },
    });
    expect(guard).toHaveBeenCalledOnce();
  });

  it('infers each transformed input independently in a heterogeneous route array', async () => {
    const app = express();

    app.use(json());
    registerRoutes(app, [
      {
        contract,
        handler(_request, response, input) {
          expectTypeOf(input.body.count).not.toBeAny();
          expectTypeOf(input.body.count).toEqualTypeOf<number>();
          response.json({ count: input.body.count });
        },
      },
      {
        contract: {
          ...contract,
          method: 'get',
          path: '/other/:id',
          request: z.object({ params: z.object({ id: z.string().transform(Number) }) }),
        },
        handler(_request, response, input) {
          expectTypeOf(input.params.id).not.toBeAny();
          expectTypeOf(input.params.id).toEqualTypeOf<number>();
          response.json({ id: input.params.id });
        },
      },
    ]);
    app.use(httpErrorHandler);

    const first = await dispatch(app, '/example/synthetic?page=2', { count: '4', label: 'Parsed' });
    const second = await dispatch(app, '/other/7', undefined, 'GET');

    expect(first).toEqual({
      status: 200,
      body: { count: 4 },
    });
    expect(second).toEqual({ status: 200, body: { id: 7 } });

    registerRoutes(express(), [
      {
        contract,
        // @ts-expect-error The schema produces a numeric count, so this handler is incompatible.
        handler: (_request: Request, _response: Response, input: { body: { count: boolean } }) => input.body.count,
      },
    ]);
  });

  it('preserves array order, guards before validation and bound controller state', async () => {
    const app = express();
    const calls: string[] = [];
    const owner = {
      label: 'Synthetic owner',
      send(_request: Request, response: Response) {
        calls.push('handler');
        response.json({ label: this.label });
      },
    };
    const unreachable = vi.fn();

    app.use(json());
    registerRoutes(
      app,
      [
        {
          contract: { ...contract, path: '/ordered', request: z.object({ body: z.never() }) },
          beforeValidation: [
            (_request, _response, next) => {
              calls.push('skip');
              next('route');
            },
          ],
          handler: unreachable,
        },
        {
          contract: { ...contract, path: '/ordered', request: z.object({ body: z.strictObject({}) }) },
          beforeValidation: [
            (_request, _response, next) => {
              calls.push('first guard');
              next();
            },
            (_request, _response, next) => {
              calls.push('second guard');
              next();
            },
          ],
          handler: owner.send,
        },
      ],
      owner,
    );
    app.use(httpErrorHandler);

    const result = await dispatch(app, '/ordered', {});

    expect(result).toEqual({ status: 200, body: { label: 'Synthetic owner' } });
    expect(calls).toEqual(['skip', 'first guard', 'second guard', 'handler']);
    expect(unreachable).not.toHaveBeenCalled();
  });

  it.each([
    ['email_invalid', 400, 'email_invalid'],
    ['password_policy', 400, 'password_policy'],
    ['intent_invalid', 403, 'intent_invalid'],
    ['synthetic_unauthorized', 401, 'synthetic_unauthorized'],
    ['__proto__', 400, 'request_invalid'],
    ['SYNTHETIC_PRIVATE_VALUE', 400, 'request_invalid'],
  ])('maps only allowlisted validation code %s without exposing Zod data', async (message, status, code) => {
    const app = express();
    const handler = vi.fn();

    app.use(json());
    registerRoute(
      app,
      { ...contract, path: '/example', request: z.object({ body: z.string({ error: message }) }) },
      handler,
    );
    app.use(httpErrorHandler);
    const result = await dispatch(app, '/example', { arbitrary: 'SYNTHETIC_PRIVATE_INPUT' });

    expect(result).toEqual({ status, body: { error: code } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects unknown fields before domain field messages and prevents delegation', async () => {
    const app = express();
    const handler = vi.fn();

    app.use(json());
    registerRoute(
      app,
      {
        ...contract,
        path: '/example',
        request: z.object({ body: z.strictObject({ count: z.string({ error: 'email_invalid' }) }) }),
      },
      handler,
    );
    app.use(httpErrorHandler);
    const result = await dispatch(app, '/example', { count: 1, unknown: true });

    expect(result).toEqual({ status: 400, body: { error: 'request_invalid' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'forwards %s asynchronous handler failures to the owning error boundary',
    async (asyncFailure) => {
      const app = express();

      registerRoute(app, { ...contract, method: 'get', path: '/example', request: z.object({}) }, () => {
        const error = new Error('SYNTHETIC_PRIVATE_HANDLER');

        if (asyncFailure) {
          return Promise.reject(error);
        }

        throw error;
      });
      app.use(httpErrorHandler);
      const result = await dispatch(app, '/example', undefined, 'GET');

      expect(result).toEqual({ status: 500, body: { error: 'internal_error' } });
    },
  );

  it('documents the registered path, request input and response output without global route state', () => {
    const first = document();
    const operation = first.paths!['/example/{id}']!.post!;

    expect(operation.operationId).toBe(contract.operationId);
    expect(operation.parameters).toHaveLength(3);
    expect(JSON.stringify(operation.requestBody)).toContain('"type":"string"');
    expect(JSON.stringify(operation.responses)).toContain('"type":"number"');
    const second = createApiDocument({
      title: 'Other API',
      version: '1',
      basePath: '/api',
      contracts: [{ ...contract, method: 'get', path: '/other', operationId: 'other', request: z.object({}) }],
    });

    expect(second.servers).toEqual([{ url: '/api' }]);
    expect(Object.keys(second.paths!)).toEqual(['/other']);
    expect(second.paths!['/other']!.get!.requestBody).toBeUndefined();
    expect(Object.keys(first.paths!)).toEqual(['/example/{id}']);
  });

  it('rejects duplicate routes and operation identifiers during composition', () => {
    expect(() => document([contract, { ...contract, operationId: 'duplicate' }])).toThrow('api_contract_duplicate');
    expect(() => document([contract, { ...contract, path: '/other' }])).toThrow('api_contract_duplicate');
  });
});
