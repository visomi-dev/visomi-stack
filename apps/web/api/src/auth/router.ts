import { randomBytes } from 'node:crypto';

import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { Database } from '@visomi-stack/backend-shared';
import { Router, json } from 'express';
import type { Request, ErrorRequestHandler } from 'express';

import type { AuthRuntime } from './runtime';
import { AuthError, csrf, rateLimit } from './security';

function body(request: Request, keys: string[]) {
  const value = request.body;

  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new AuthError('request_invalid');
  }

  return value as Record<string, unknown>;
}

function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
  ) {
    throw new AuthError('request_invalid');
  }

  return value;
}

function webAuthnResponse(value: unknown): RegistrationResponseJSON & AuthenticationResponseJSON {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as { id?: unknown }).id !== 'string' ||
    !(value as { response?: unknown }).response ||
    typeof (value as { response: unknown }).response !== 'object'
  ) {
    throw new AuthError('request_invalid');
  }

  return value as RegistrationResponseJSON & AuthenticationResponseJSON;
}

function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) {
    throw new AuthError('request_invalid');
  }

  return value.trim();
}

export function saveSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    request.session.save((error) => (error ? reject(new AuthError('session_unavailable', 503)) : resolve())),
  );
}

async function establishSession(request: Request, user: Express.User) {
  await new Promise<void>((resolve, reject) =>
    request.logIn(user, (error) => (error ? reject(new AuthError('session_unavailable', 503)) : resolve())),
  );
  request.session.csrf = randomBytes(32).toString('base64url');
  await saveSession(request);
}

export function authRouter(auth: AuthRuntime, database: Database) {
  const router = Router();
  const { passkeys, config } = auth;

  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(auth.requireInitialized);
  router.use(rateLimit(database, config));
  router.use(csrf(config));
  router.use(json({ limit: '32kb' }));
  router.get('/session', async (request, response) => {
    request.session.csrf ??= randomBytes(32).toString('base64url');
    await saveSession(request);
    response.json({
      authenticated: request.isAuthenticated(),
      user: request.user ? { id: request.user.id } : null,
      csrfToken: request.session.csrf,
    });
  });
  router.post('/passkeys/registration/options', async (request, response) => {
    body(request, []);
    const result = await passkeys.registrationOptions(request.sessionID, request.user);

    response.json(result);
  });
  router.post('/passkeys/registration/verify', async (request, response) => {
    const input = body(request, ['challengeId', 'response', 'label']);
    const result = await passkeys.register(
      request.sessionID,
      identifier(input.challengeId),
      webAuthnResponse(input.response),
      input.label === undefined ? 'Passkey' : label(input.label),
      request.user,
    );

    await establishSession(request, result);
    response.status(201).json({ authenticated: true, user: { id: result.id }, csrfToken: request.session.csrf });
  });
  router.post('/passkeys/authentication/options', async (request, response) => {
    body(request, []);
    const result = await passkeys.authenticationOptions(request.sessionID);

    response.json(result);
  });
  router.post('/passkeys/authentication/verify', async (request, response) => {
    const input = body(request, ['challengeId', 'response']);
    const result = await passkeys.authenticate(
      request.sessionID,
      identifier(input.challengeId),
      webAuthnResponse(input.response),
    );

    await establishSession(request, result);
    response.json({ authenticated: true, user: { id: result.id }, csrfToken: request.session.csrf });
  });
  router.post('/logout', async (request, response) => {
    body(request, []);
    await new Promise<void>((resolve, reject) =>
      request.session.destroy((error) => (error ? reject(new AuthError('session_unavailable', 503)) : resolve())),
    );
    response.clearCookie(config.cookieName, { httpOnly: true, secure: config.secure, sameSite: 'strict', path: '/' });
    response.status(204).end();
  });
  router.use('/passkeys', (request, _response, next) => {
    next(request.isAuthenticated() ? undefined : new AuthError('authentication_required', 401));
  });
  router.get('/passkeys', async (request, response) => {
    const result = await passkeys.list(request.user!);

    response.json({ credentials: result });
  });
  router.patch('/passkeys/:id', async (request, response) => {
    const input = body(request, ['label']);

    await passkeys.rename(request.sessionID, request.user!, identifier(request.params.id), label(input.label));
    response.status(204).end();
  });
  router.delete('/passkeys/:id', async (request, response) => {
    await passkeys.revoke(request.sessionID, request.user!, identifier(request.params.id));
    response.status(204).end();
  });

  return router;
}

export const authErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);

    return;
  }

  if (error instanceof AuthError) {
    response.status(error.status).json({ error: error.code });

    return;
  }

  if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
    response.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'request_invalid' });

    return;
  }

  // Includes SQL/driver failures; neither the query nor its parameters leave the boundary.
  response.status(503).json({ error: 'authentication_unavailable' });
};
