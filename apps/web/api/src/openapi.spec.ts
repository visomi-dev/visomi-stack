import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { createInjector } from '@visomi-stack/backend-shared';
import { httpErrorHandler } from '@visomi-stack/web-backend-shared';
import express, { json, type Request, type RequestHandler, type Response } from 'express';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { z } from 'zod';

import { createApp } from './app';
import { devicesContracts } from './auth/devices/contract';
import { DevicesController } from './auth/devices/controller';
import { createDeviceRouter } from './auth/devices/router';
import { Devices } from './auth/devices/service';
import { emailSchema } from './auth/email/schema';
import { googleContracts } from './auth/google/contract';
import { loginPasswordSchema, newPasswordSchema } from './auth/password/schema';
import { SessionResponses } from './auth/sessions/response';
import { authContracts, createOpenApiDocument } from './openapi';

function dispatch(app: RequestHandler, path: string, body?: unknown, method = 'GET') {
  const request = new IncomingMessage(new Socket()) as Request;
  const response = new ServerResponse(request);
  const text = body === undefined ? undefined : JSON.stringify(body);

  request.method = method;
  request.url = path;
  Object.assign(request, { sessionID: 'synthetic-browser' });
  if (text !== undefined) {
    request.headers['content-type'] = 'application/json';
    request.headers['content-length'] = String(Buffer.byteLength(text));
  }

  return new Promise<{ status: number; body: ReturnType<typeof createOpenApiDocument> }>((resolve, reject) => {
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

describe('authentication contracts and injectable HTTP controllers', () => {
  it('publishes a complete resource-free OpenAPI document with the standalone or embedded base path', async () => {
    const standalone = await dispatch(createApp(), '/openapi.json');
    const embedded = await dispatch(createApp({ basePath: '/api' }), '/openapi.json');

    expect(standalone.status).toBe(200);
    expect(standalone.body.openapi).toBe('3.1.0');
    expect(standalone.body.servers).toEqual([{ url: '/' }]);
    expect(embedded.body.servers).toEqual([{ url: '/api' }]);
    expect(Object.keys(standalone.body.paths!)).toHaveLength(
      new Set(authContracts.map((contract) => contract.path)).size + 2,
    );
    for (const contract of authContracts) {
      const path = contract.path.replace(/:id/g, '{id}');
      const operation = standalone.body.paths![path]![contract.method]!;

      expect(operation.operationId).toBe(contract.operationId);
      expect(operation.responses).toEqual(
        expect.objectContaining({ 429: expect.any(Object), 503: expect.any(Object) }),
      );
    }
    expect(standalone.body.paths!['/auth/password/verify']!.post!.security).toEqual([
      { sessionCookie: [], csrf: [] },
      { localSessionCookie: [], csrf: [] },
    ]);
    expect(standalone.body.paths!['/auth/sessions/{id}']!.delete!.parameters).toEqual([
      expect.objectContaining({ in: 'path', name: 'id', required: true }),
    ]);
    expect(standalone.body.components!.securitySchemes).toEqual(
      expect.objectContaining({
        sessionCookie: expect.objectContaining({ in: 'cookie', name: '__Host-visomi.sid' }),
        csrf: expect.objectContaining({ in: 'header', name: 'X-CSRF-Token' }),
      }),
    );
    expect(JSON.stringify(standalone.body)).not.toContain('SYNTHETIC_PRIVATE');
  });

  it('passes normalized, inferred contract output to a class controller before service invocation', async () => {
    expectTypeOf<z.output<typeof devicesContracts.requestApproval.request>['body']['email']>().toEqualTypeOf<string>();
    expectTypeOf<Parameters<DevicesController['requestApproval']>[2]['body']['email']>().toEqualTypeOf<string>();
    const request = vi.fn().mockResolvedValue({
      requestId: '11111111-1111-4111-8111-111111111111',
      userCode: '123456',
      expiresAt: new Date(),
    });
    const injector = createInjector([
      DevicesController,
      { provide: Devices, useValue: { request } },
      { provide: SessionResponses, useValue: {} },
    ]);
    const controller = injector.get<DevicesController>(DevicesController);
    const app = express();

    app.use(json());
    app.use(createDeviceRouter(controller));
    app.use(httpErrorHandler);
    const result = await dispatch(app, '/device-approval/request', { email: '  Synthetic@Example.Test  ' }, 'POST');

    expect(result.status).toBe(201);
    expect(request).toHaveBeenCalledExactlyOnceWith('synthetic-browser', 'synthetic@example.test');
    const invalid = await dispatch(
      app,
      '/device-approval/request',
      { email: 'synthetic@example.test', unexpected: true },
      'POST',
    );

    expect(invalid.status).toBe(400);
    expect(request).toHaveBeenCalledOnce();
  });

  it('preserves separate new-password and login rules, NFC Unicode policy and Google intent defaults', () => {
    for (const password of ['short', 'x'.repeat(129)]) {
      expect(newPasswordSchema.safeParse(password).success).toBe(false);
    }
    const normalized = newPasswordSchema.parse('Synthetic e\u0301 password!');

    expect(normalized).toBe('Synthetic é password!');
    expect(newPasswordSchema.safeParse('😀'.repeat(12)).success).toBe(true);
    expect(loginPasswordSchema.safeParse('short').success).toBe(true);
    expect(loginPasswordSchema.safeParse('x'.repeat(513)).success).toBe(false);
    expect(loginPasswordSchema.safeParse('😀'.repeat(257)).success).toBe(false);
    expect(emailSchema.safeParse('invalid').success).toBe(false);
    expect(googleContracts.startGoogle.request.shape.body.parse({})).toEqual({ intent: 'login' });
    expect(googleContracts.startGoogle.request.shape.body.parse({ intent: null })).toEqual({ intent: 'login' });
    expect(googleContracts.startGoogle.request.shape.body.parse({ intent: 'link' })).toEqual({ intent: 'link' });
  });
});
