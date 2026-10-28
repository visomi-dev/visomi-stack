import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { createInjector } from '@visomi-stack/backend-shared';
import { AuthHttpError, httpErrorHandler, registerRoutes } from '@visomi-stack/web-backend-shared';
import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  AUTHORIZATION_POLICY,
  Authorization,
  anonymous,
  denyPermissions,
  type AuthorizationPolicy,
} from './authorization';
import type { Principal } from './identity';

const principal: Principal = {
  id: 'synthetic-owner',
  method: 'password',
  authenticatedAt: Date.now(),
  version: 1,
  level: 'full',
  email: 'synthetic@example.test',
  emailVerified: true,
};

function authorization(policy: AuthorizationPolicy = denyPermissions): Authorization {
  return createInjector([Authorization, { provide: AUTHORIZATION_POLICY, useValue: policy }]).get<Authorization>(
    Authorization,
  );
}

function application(guards: RequestHandler[], global = false) {
  const app = express();
  const router = Router();

  if (global) {
    router.use(...guards);
  }

  registerRoutes(router, [
    {
      contract: {
        method: 'get',
        path: '/documents/:id',
        operationId: 'synthetic_read',
        summary: 'Synthetic authorization boundary',
        tags: ['test'],
        security: [],
        request: z.object({ params: z.object({ id: z.string() }) }),
        responses: { 200: { description: 'Authorized.' } },
      },
      beforeValidation: global ? [] : guards,
      handler: (_request, response) => response.json({ allowed: true }),
    },
  ]);
  app.use('/api', router);
  app.use(httpErrorHandler);

  return app;
}

function dispatch(app: ReturnType<typeof express>, user?: Express.User, id = principal.id) {
  const request = new IncomingMessage(new Socket()) as Request;
  const response = new ServerResponse(request);

  request.method = 'GET';
  request.url = `/api/documents/${id}`;
  request.user = user;
  // A Passport flag or client-supplied claims cannot replace a verified principal/policy.
  Object.assign(request, { isAuthenticated: () => true });
  request.headers = { 'x-permissions': 'documents.read' };

  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    vi.spyOn(response, 'end').mockImplementation((chunk?: unknown) => {
      resolve({ status: response.statusCode, body: chunk ? JSON.parse(String(chunk)) : undefined });

      return response;
    });
    app(request, response as Response, reject);
  });
}

describe('composable authentication and authorization middleware', () => {
  it.each([false, true])('supports anonymous middleware at route/router scope (global=%s)', async (global) => {
    const app = application([anonymous], global);
    const allowed = await dispatch(app);

    expect(allowed.status).toBe(200);
    for (const level of ['full', 'unverified', 'recovery', 'enrollment'] as const) {
      const denied = await dispatch(app, { ...principal, level });

      expect(denied).toEqual({ status: 403, body: { error: 'anonymous_session_required' } });
    }
  });

  it.each([false, true])('requires a full verified principal at route/router scope (global=%s)', async (global) => {
    const app = application([authorization().authenticated()], global);
    const anonymousResult = await dispatch(app);
    const malformed = await dispatch(app, { id: principal.id, authenticatedAt: Date.now() });

    expect(anonymousResult).toEqual({ status: 401, body: { error: 'authentication_required' } });
    expect(malformed.status).toBe(401);
    for (const user of [
      { ...principal, level: 'unverified' as const },
      { ...principal, level: 'recovery' as const },
      { ...principal, level: 'enrollment' as const },
      { ...principal, emailVerified: false },
    ]) {
      const denied = await dispatch(app, user);

      expect(denied).toEqual({ status: 403, body: { error: 'account_verification_required' } });
    }
    const allowed = await dispatch(app, principal);

    expect(allowed).toEqual({ status: 200, body: { allowed: true } });
  });

  it('fails permission arrays closed without an injected policy and never evaluates anonymous requests', async () => {
    const policy = vi.fn(denyPermissions);
    const app = application([authorization(policy).authenticated(['documents.read'])]);
    const anonymousResult = await dispatch(app);

    expect(anonymousResult.status).toBe(401);
    expect(policy).not.toHaveBeenCalled();
    const denied = await dispatch(app, principal);

    expect(denied).toEqual({ status: 403, body: { error: 'permission_denied' } });
    expect(policy).toHaveBeenCalledOnce();
  });

  it('supports ABAC decisions per route after global authentication, without caching authorization', async () => {
    let active = true;
    const policy = vi.fn<AuthorizationPolicy>(
      (permission, context) =>
        active && permission === 'documents.read' && context.principal.id === context.request.params.id,
    );
    const access = authorization(policy);
    const app = express();

    app.use(access.authenticated());
    app.use(application([access.authorized(['documents.read'])]));
    const allowed = await dispatch(app, principal);
    const foreign = await dispatch(app, principal, 'synthetic-foreign-owner');

    expect(allowed.status).toBe(200);
    expect(foreign).toEqual({ status: 403, body: { error: 'permission_denied' } });
    expect(policy).toHaveBeenCalledTimes(2);
    active = false;
    const revoked = await dispatch(app, principal);

    expect(revoked.status).toBe(403);
    expect(policy).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])('accepts a route requirement predicate (async=%s)', async (asynchronous) => {
    const policy = vi.fn(denyPermissions);
    const access = authorization(policy);
    const guard = access.authenticated((context) => {
      const allowed = context.principal.id === context.request.params.id;

      return asynchronous ? Promise.resolve(allowed) : allowed;
    });
    const app = application([guard]);
    const allowed = await dispatch(app, principal);
    const denied = await dispatch(app, principal, 'synthetic-foreign-owner');

    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(403);
    expect(policy).not.toHaveBeenCalled();
  });

  it('checks every required permission and snapshots the declared array', async () => {
    const policy = vi.fn<AuthorizationPolicy>((permission) => permission === 'documents.read');
    const access = authorization(policy);
    const required = ['documents.read', 'documents.update'];
    const app = application([access.authenticated(required)]);

    required.pop();
    const denied = await dispatch(app, principal);

    expect(denied.status).toBe(403);
    expect(policy.mock.calls.map(([permission]) => permission)).toEqual(['documents.read', 'documents.update']);
  });

  it.each(['policy', 'predicate', 'controlled', 'truthy'] as const)(
    'sanitizes failures and grants access only for an explicit true decision (%s)',
    async (kind) => {
      const raw = new Error('SYNTHETIC_PRIVATE_POLICY');
      const unexpectedDecision = vi.fn().mockReturnValue('SYNTHETIC_PRIVATE_TRUTHY');
      const policy = vi.fn<AuthorizationPolicy>().mockRejectedValue(raw);
      const access = authorization(policy);
      const guard =
        kind === 'policy'
          ? access.authenticated(['documents.read'])
          : access.authorized(() => {
              if (kind === 'controlled') {
                throw new AuthHttpError(401, 'reauthentication_required');
              }

              if (kind === 'truthy') {
                return unexpectedDecision();
              }

              throw raw;
            });
      const result = await dispatch(application([guard]), principal);

      expect(result).toEqual(
        kind === 'controlled'
          ? { status: 401, body: { error: 'reauthentication_required' } }
          : kind === 'truthy'
            ? { status: 403, body: { error: 'permission_denied' } }
            : { status: 503, body: { error: 'authorization_unavailable' } },
      );
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE');
    },
  );

  it('keeps the authorization-only guard closed for an anonymous request even without the global guard', async () => {
    const policy = vi.fn<AuthorizationPolicy>().mockResolvedValue(true);
    const result = await dispatch(application([authorization(policy).authorized(['documents.read'])]));

    expect(result.status).toBe(401);
    expect(policy).not.toHaveBeenCalled();
  });
});
