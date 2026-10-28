import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { AuthHttpError, HttpError, httpErrorHandler } from '@visomi-stack/web-backend-shared';
import type { Request, Response } from 'express';
import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { storage } from '../../tests/support/auth-state';
import { authInjector } from '../../tests/support/injection';

import { DevicesController } from './devices/controller';
import { EmailController } from './email/controller';
import { EmailIdentity } from './email/service';
import { GoogleController } from './google/controller';
import { MethodsController } from './methods/controller';
import { PasskeysController } from './passkeys/controller';
import { Passkeys } from './passkeys/service';
import { PasswordController } from './password/controller';
import { RecoveryController } from './recovery/controller';
import { authErrorHandler, createAuthRouter, saveSession } from './router';
import type { AuthRuntime } from './runtime';
import { SessionsController } from './sessions/controller';
import { Authorization } from './shared/authorization';
import { authConfig } from './shared/config';
import { SecurityNotifications } from './shared/notifications';
import { rateLimit } from './shared/security';
import { TotpController } from './totp/controller';

describe('authentication HTTP boundary', () => {
  it('saves the session before returning and sanitizes failed persistence', async () => {
    const save = vi.fn((callback: (error?: Error) => void) => callback());

    await saveSession({ session: { save } } as unknown as Request);
    expect(save).toHaveBeenCalledOnce();
    save.mockImplementation((callback) => callback(new Error('SYNTHETIC_PRIVATE_SQL')));
    await expect(saveSession({ session: { save } } as unknown as Request)).rejects.toMatchObject({
      code: 'session_unavailable',
    });
  });

  it.each([
    [new AuthHttpError(401, 'authentication_required'), 401, 'authentication_required'],
    [new HttpError(422, 'request_invalid', 'Check the request.', { field: 'label' }), 422, 'request_invalid'],
    [new Error('SYNTHETIC_PRIVATE_SQL_PARAMETERS'), 503, 'authentication_unavailable'],
  ])('normalizes failures and delegates public errors to the owning response handler', (error, status, code) => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn();

    authErrorHandler(error, {} as Request, response, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(HttpError);
    expect(next.mock.calls[0][0]).toMatchObject({ status, code });
    if (HttpError.is(error)) {
      expect(next).toHaveBeenCalledExactlyOnceWith(error);
    }

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('delegates a started response to the existing operational error handler', () => {
    const next = vi.fn();
    const error = new Error('SYNTHETIC_PRIVATE_ERROR');

    authErrorHandler(error, {} as Request, { headersSent: true } as Response, next);
    expect(next).toHaveBeenCalledWith(error);
  });
});

vi.mock('./shared/security', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shared/security')>();

  return {
    ...actual,
    rateLimit: vi.fn(() => (_request: Request, _response: Response, next: () => void) => next()),
  };
});

beforeEach(() => vi.clearAllMocks());

const challengeId = '11111111-1111-4111-8111-111111111111';
const credentialId = '22222222-2222-4222-8222-222222222222';
const user = {
  id: '33333333-3333-4333-8333-333333333333',
  credentialId,
  method: 'passkey' as const,
  methodId: credentialId,
  version: 1,
  level: 'full' as const,
  email: 'synthetic@example.test',
  emailVerified: true,
  authenticatedAt: 123456,
};
const response = {
  id: 'synthetic_public_key',
  rawId: 'synthetic_public_key',
  type: 'public-key',
  clientExtensionResults: {},
  response: {
    clientDataJSON: 'synthetic',
    attestationObject: 'synthetic',
    authenticatorData: 'synthetic',
    signature: 'synthetic',
  },
};

function routerFixture() {
  const config = authConfig({
    origin: 'http://localhost',
    rpId: 'localhost',
    secret: 'synthetic-session-secret-with-32-bytes',
  });
  const passkeys = {
    registrationOptions: vi.fn().mockResolvedValue({ challengeId, options: { challenge: 'synthetic' } }),
    authenticationOptions: vi.fn().mockResolvedValue({ challengeId, options: { challenge: 'synthetic' } }),
    register: vi.fn().mockResolvedValue(user),
    authenticate: vi.fn().mockResolvedValue(user),
    list: vi.fn().mockResolvedValue([{ id: credentialId, label: 'Synthetic' }]),
    rename: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
  const save = vi.fn((callback: (error?: Error) => void) => callback());
  const destroy = vi.fn((callback: (error?: Error) => void) => callback());
  const logIn = vi.fn((_user: Express.User, callback: (error?: Error) => void) => callback());
  const requireInitialized = vi.fn((_request: Request, _response: Response, next: (error?: Error) => void) => next());
  const database = storage().db;
  const requestLimits = {};
  const notifications = { notify: vi.fn().mockResolvedValue(true) };
  const email = {
    emailStart: vi.fn().mockResolvedValue({ flowId: challengeId }),
  };
  const injector = authInjector(database, config, [
    { provide: Passkeys, useValue: passkeys },
    { provide: EmailIdentity, useValue: email },
    { provide: SecurityNotifications, useValue: notifications },
  ]);
  const authorization = injector.get<Authorization>(Authorization);
  const auth = {
    authenticated: authorization.authenticated.bind(authorization),
    controllers: {
      devices: injector.get<DevicesController>(DevicesController),
      email: injector.get<EmailController>(EmailController),
      google: injector.get<GoogleController>(GoogleController),
      methods: injector.get<MethodsController>(MethodsController),
      passkeys: injector.get<PasskeysController>(PasskeysController),
      password: injector.get<PasswordController>(PasswordController),
      recovery: injector.get<RecoveryController>(RecoveryController),
      sessions: injector.get<SessionsController>(SessionsController),
      totp: injector.get<TotpController>(TotpController),
    },
    config,
    passkeys,
    requireInitialized,
    database,
    email,
    notifications,
    requestLimits,
  } as unknown as AuthRuntime;
  const app = express();

  app.use('/auth', createAuthRouter(auth), authErrorHandler);
  app.use(httpErrorHandler);

  const dispatch = (
    method: string,
    path: string,
    body?: unknown,
    options: { user?: Express.User; raw?: string; origin?: string } = {},
  ) => {
    const request = new IncomingMessage(new Socket()) as Request;
    const output = new ServerResponse(request);
    const data = options.raw ?? (body === undefined ? undefined : JSON.stringify(body));

    request.method = method;
    request.url = '/auth' + path;
    request.headers = { origin: options.origin ?? config.origin, 'x-csrf-token': 'synthetic_csrf' };

    if (data !== undefined) {
      request.headers['content-type'] = 'application/json';
      request.headers['content-length'] = String(Buffer.byteLength(data));
    }

    Object.assign(request, {
      sessionID: 'synthetic-session',
      session: { csrf: 'synthetic_csrf', save, destroy },
      user: options.user,
      isAuthenticated: () => Boolean(request.user),
      logIn: (user: Express.User, callback: (error?: Error) => void) => {
        request.user = user;
        logIn(user, callback);
      },
    });

    return new Promise<{ status: number; body: unknown; headers: ReturnType<ServerResponse['getHeaders']> }>(
      (resolve, reject) => {
        vi.spyOn(output, 'end').mockImplementation((chunk?: unknown) => {
          resolve({
            status: output.statusCode,
            body: chunk ? JSON.parse(String(chunk)) : undefined,
            headers: output.getHeaders(),
          });

          return output;
        });
        app(request, output as Response, reject);

        if (data !== undefined) {
          request.push(data);
        }

        request.push(null);
      },
    );
  };

  return { dispatch, passkeys, database, save, destroy, logIn, requireInitialized, requestLimits };
}

describe('authentication router decisions and delegation', () => {
  it('keeps separately composed runtimes isolated when their routes run concurrently', async () => {
    const first = routerFixture();
    const second = routerFixture();

    first.passkeys.list.mockResolvedValue([{ id: credentialId, label: 'First runtime' }]);
    second.passkeys.list.mockResolvedValue([{ id: credentialId, label: 'Second runtime' }]);
    const [firstResponse, secondResponse] = await Promise.all([
      first.dispatch('GET', '/passkeys', undefined, { user }),
      second.dispatch('GET', '/passkeys', undefined, { user }),
    ]);

    expect(firstResponse.body).toEqual({ credentials: [{ id: credentialId, label: 'First runtime' }] });
    expect(secondResponse.body).toEqual({ credentials: [{ id: credentialId, label: 'Second runtime' }] });
    expect(first.passkeys.list).toHaveBeenCalledExactlyOnceWith(user);
    expect(second.passkeys.list).toHaveBeenCalledExactlyOnceWith(user);
  });

  it('reports disabled providers and rejects unsupported Google intent', async () => {
    const fixture = routerFixture();
    const providers = await fixture.dispatch('GET', '/providers');

    expect(providers.body).toMatchObject({ google: { enabled: false, clientId: null }, totp: false });
    const invalid = await fixture.dispatch('POST', '/google/start', { intent: 'unsupported' });

    expect(invalid.status).toBe(403);
    const pending = await fixture.dispatch(
      'POST',
      '/email/request',
      { email: 'synthetic@example.test' },
      { user: { ...user, email: null, level: 'unverified', emailVerified: false } },
    );

    expect(pending.status).toBe(202);
  });

  it('guards protected operations before validation or controller delegation', async () => {
    const fixture = routerFixture();
    const operations = [
      ['POST', '/reauth/password/start'],
      ['POST', '/reauth/password/complete'],
      ['POST', '/password/add'],
      ['POST', '/password/change'],
      ['POST', '/password/remove'],
      ['POST', '/email/change/request'],
      ['POST', '/email/change/verify'],
      ['POST', '/device-approval/review'],
      ['POST', '/device-approval/approve'],
      ['POST', '/device-approval/deny'],
      ['DELETE', `/google/${credentialId}`],
      ['GET', '/methods'],
      ['GET', '/sessions'],
      ['DELETE', `/sessions/${credentialId}`],
      ['POST', '/sessions/revoke-others'],
      ['POST', '/totp/setup'],
      ['POST', '/totp/confirm'],
      ['DELETE', '/totp'],
      ['POST', '/recovery-codes/regenerate'],
    ];

    for (const [method, path] of operations) {
      const missing = await fixture.dispatch(method, path, {});
      const unverified = await fixture.dispatch(
        method,
        path,
        {},
        { user: { ...user, level: 'unverified', emailVerified: false } },
      );

      expect(missing.body, path).toEqual({ error: 'authentication_required' });
      expect(missing.status, path).toBe(401);
      expect(unverified.body, path).toEqual({ error: 'account_verification_required' });
      expect(unverified.status, path).toBe(403);
    }
    for (const path of ['/email/request', '/email/verify', '/recovery/password', '/recovery/password/complete']) {
      const missing = await fixture.dispatch('POST', path, {});

      expect(missing.status, path).toBe(401);
    }
  });

  it('selects Google access middleware by intent while leaving malformed requests to the contract', async () => {
    const fixture = routerFixture();

    for (const intent of [undefined, null, 'login']) {
      const anonymous = await fixture.dispatch('POST', '/google/start', { intent });
      const signedIn = await fixture.dispatch('POST', '/google/start', { intent }, { user });

      expect(anonymous.status).toBe(404);
      expect(signedIn.body).toEqual({ error: 'anonymous_session_required' });
    }
    for (const intent of ['link', 'reauth']) {
      const missing = await fixture.dispatch('POST', '/google/start', { intent });
      const signedIn = await fixture.dispatch('POST', '/google/start', { intent }, { user });

      expect(missing.status).toBe(401);
      expect(signedIn.status).toBe(404);
    }
    const missingBody = await fixture.dispatch('POST', '/google/start');
    const invalidIntent = await fixture.dispatch('POST', '/google/start', { intent: 42 });

    expect(missingBody.status).toBe(400);
    expect(invalidIntent.body).toEqual({ error: 'intent_invalid' });
  });

  it('uses the runtime database as the only rate-limit source', () => {
    const fixture = routerFixture();

    expect(rateLimit).toHaveBeenCalledExactlyOnceWith(
      fixture.requestLimits,
      expect.objectContaining({ rpId: 'localhost' }),
    );
  });

  it('allows an initialized anonymous session and returns only public session fields', async () => {
    const fixture = routerFixture();
    const anonymous = await fixture.dispatch('GET', '/session');
    const authenticated = await fixture.dispatch('GET', '/session', undefined, { user });

    expect(anonymous.body).toMatchObject({ authenticated: false, user: null, csrfToken: 'synthetic_csrf' });
    expect(authenticated.body).toMatchObject({
      authenticated: true,
      user: { id: user.id },
      csrfToken: 'synthetic_csrf',
    });
    expect(anonymous.headers['cache-control']).toBe('no-store');
    expect(fixture.save).toHaveBeenCalledTimes(2);
  });

  it('requires inherited initialization before session persistence or passkey work', async () => {
    const fixture = routerFixture();

    fixture.requireInitialized.mockImplementation((_request, _response, next) =>
      next(new HttpError(503, 'auth_initialization_missing')),
    );
    const result = await fixture.dispatch('GET', '/session');

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'auth_initialization_missing' });
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it.each([
    ['/passkeys/registration/options', 'registrationOptions'],
    ['/passkeys/authentication/options', 'authenticationOptions'],
  ] as const)('delegates %s with the server session and authenticated identity', async (path, operation) => {
    const fixture = routerFixture();
    const result = await fixture.dispatch('POST', path, {}, { user });

    expect(result.status).toBe(200);
    expect(fixture.passkeys[operation]).toHaveBeenCalledExactlyOnceWith(
      ...(operation === 'registrationOptions' ? ['synthetic-session', user, undefined] : ['synthetic-session']),
    );
    expect(fixture.logIn).not.toHaveBeenCalled();
  });

  it.each([undefined, '  Named passkey  '])(
    'validates registration, normalizes its label and establishes the verified identity',
    async (label) => {
      const fixture = routerFixture();
      const result = await fixture.dispatch('POST', '/passkeys/registration/verify', {
        challengeId,
        response,
        ...(label === undefined ? {} : { label }),
      });

      expect(fixture.passkeys.register).toHaveBeenCalledExactlyOnceWith(
        'synthetic-session',
        challengeId,
        response,
        label === undefined ? 'Passkey' : 'Named passkey',
        undefined,
      );
      expect(fixture.logIn).toHaveBeenCalledWith(user, expect.any(Function));
      expect(fixture.save).toHaveBeenCalledOnce();
      expect(result.status).toBe(201);
      expect(result.body).toMatchObject({ authenticated: true, user: { id: user.id }, csrfToken: expect.any(String) });
      expect((result.body as { csrfToken: string }).csrfToken).not.toBe('synthetic_csrf');
    },
  );

  it('delegates authentication and rotates CSRF only after a verified principal is returned', async () => {
    const fixture = routerFixture();
    const result = await fixture.dispatch('POST', '/passkeys/authentication/verify', { challengeId, response });

    expect(fixture.passkeys.authenticate).toHaveBeenCalledExactlyOnceWith(
      'synthetic-session',
      challengeId,
      response,
      undefined,
    );
    expect(fixture.logIn).toHaveBeenCalledWith(user, expect.any(Function));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ authenticated: true, user: { id: user.id }, csrfToken: expect.any(String) });
  });

  it.each([
    ['POST', '/passkeys/registration/options', { userId: user.id }],
    ['POST', '/passkeys/registration/options', { email: 'synthetic@example.test' }],
    ['POST', '/passkeys/authentication/options', []],
    ['POST', '/passkeys/registration/verify', { challengeId: 'invalid', response }],
    ['POST', '/passkeys/registration/verify', { challengeId, response, label: ' ' }],
    ['POST', '/passkeys/registration/verify', { challengeId, response, label: 'x'.repeat(65) }],
    ['POST', '/passkeys/authentication/verify', { challengeId, response: { id: 'synthetic' } }],
    ['POST', '/passkeys/authentication/verify', { challengeId, response, userId: user.id }],
    ['PATCH', '/passkeys/invalid', { label: 'Name' }],
    ['PATCH', '/passkeys/' + credentialId, { label: 42 }],
  ])('rejects invalid input for %s %s before delegating', async (method, path, body) => {
    const fixture = routerFixture();
    const result = await fixture.dispatch(method as string, path as string, body, { user });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'request_invalid' });
    for (const operation of Object.values(fixture.passkeys)) {
      expect(operation).not.toHaveBeenCalled();
    }
    expect(fixture.logIn).not.toHaveBeenCalled();
  });

  it('enforces CSRF before delegating a mutation', async () => {
    const fixture = routerFixture();
    const result = await fixture.dispatch(
      'POST',
      '/passkeys/registration/options',
      {},
      { origin: 'https://other.example.test' },
    );

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'csrf_invalid' });
    expect(fixture.passkeys.registrationOptions).not.toHaveBeenCalled();
  });

  it.each(['GET', 'PATCH', 'DELETE'])('requires authentication for %s credential operations', async (method) => {
    const fixture = routerFixture();
    const path = method === 'GET' ? '/passkeys' : '/passkeys/' + credentialId;
    const result = await fixture.dispatch(method, path, method === 'PATCH' ? { label: 'Name' } : undefined);

    expect(result.status).toBe(401);
    expect(fixture.passkeys.list).not.toHaveBeenCalled();
    expect(fixture.passkeys.rename).not.toHaveBeenCalled();
    expect(fixture.passkeys.revoke).not.toHaveBeenCalled();
  });

  it('delegates credential listing, rename and revocation using the authenticated owner', async () => {
    const fixture = routerFixture();
    const listed = await fixture.dispatch('GET', '/passkeys', undefined, { user });
    const renamed = await fixture.dispatch('PATCH', '/passkeys/' + credentialId, { label: '  Renamed  ' }, { user });
    const revoked = await fixture.dispatch('DELETE', '/passkeys/' + credentialId, undefined, { user });

    expect(listed.body).toEqual({ credentials: [{ id: credentialId, label: 'Synthetic' }] });
    expect(fixture.passkeys.list).toHaveBeenCalledExactlyOnceWith(user);
    expect(fixture.passkeys.rename).toHaveBeenCalledExactlyOnceWith('synthetic-session', user, credentialId, 'Renamed');
    expect(fixture.passkeys.revoke).toHaveBeenCalledExactlyOnceWith('synthetic-session', user, credentialId);
    expect(renamed.status).toBe(204);
    expect(revoked.status).toBe(204);
  });

  it('rejects switching the authenticated subject during a passkey reauthentication', async () => {
    const fixture = routerFixture();
    const result = await fixture.dispatch(
      'POST',
      '/passkeys/authentication/verify',
      { challengeId, response },
      { user: { ...user, id: '44444444-4444-4444-8444-444444444444' } },
    );

    expect(result.status).toBe(403);
    expect(fixture.logIn).not.toHaveBeenCalled();
  });

  it('revokes the session and clears its cookie on logout', async () => {
    const fixture = routerFixture();
    const result = await fixture.dispatch('POST', '/logout', {});

    expect(fixture.destroy).toHaveBeenCalledOnce();
    expect(result.status).toBe(204);
    expect(String(result.headers['set-cookie'])).toContain('visomi.sid=;');
  });

  it.each([
    [new HttpError(409, 'last_credential'), 409, 'last_credential'],
    [new Error('SYNTHETIC_PRIVATE_SQL_PARAMETERS'), 503, 'authentication_unavailable'],
  ])('sanitizes rejected authentication without establishing a session', async (error, status, code) => {
    const fixture = routerFixture();

    fixture.passkeys.authenticate.mockRejectedValueOnce(error);
    const result = await fixture.dispatch('POST', '/passkeys/authentication/verify', { challengeId, response });

    expect(result.status).toBe(status);
    expect(result.body).toEqual({ error: code });
    expect(fixture.logIn).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
  });

  it.each(['login', 'save', 'logout'] as const)(
    'reports failed %s session persistence without a success response',
    async (operation) => {
      const fixture = routerFixture();
      const error = new Error('SYNTHETIC_PRIVATE_SESSION');

      if (operation === 'login') {
        fixture.logIn.mockImplementation((_user, callback) => callback(error));
      }

      if (operation === 'save') {
        fixture.save.mockImplementation((callback) => callback(error));
      }

      if (operation === 'logout') {
        fixture.destroy.mockImplementation((callback) => callback(error));
      }

      const path = operation === 'logout' ? '/logout' : '/passkeys/authentication/verify';
      const input = operation === 'logout' ? {} : { challengeId, response };
      const result = await fixture.dispatch('POST', path, input);

      expect(result.status).toBe(503);
      expect(result.body).toEqual({ error: 'session_unavailable' });
      expect(result.headers['set-cookie']).toBeUndefined();
    },
  );

  it.each([
    ['{', 400],
    [JSON.stringify({ oversized: 'x'.repeat(33000) }), 413],
  ] as const)('returns a controlled response for rejected JSON', async (raw, status) => {
    const fixture = routerFixture();
    const result = await fixture.dispatch('POST', '/passkeys/registration/options', undefined, { raw });

    expect(result.status).toBe(status);
    expect(result.body).toEqual({ error: 'request_invalid' });
    expect(fixture.passkeys.registrationOptions).not.toHaveBeenCalled();
  });
});
