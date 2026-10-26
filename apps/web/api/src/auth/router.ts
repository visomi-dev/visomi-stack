import { randomBytes } from 'node:crypto';

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { ErrorRequestHandler } from 'express';
import { Router, json } from 'express';
import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';

import type { AuthRuntime } from './runtime';
import { csrf, rateLimit } from './security';
import { accountRouter } from './account-router';
import { body, identifier, establishSession, saveSession, sessionView } from './http';
import { requireFull } from './identity';
import { normalizeEmail } from './secrets';
export { saveSession } from './http';

function webAuthnResponse(value: unknown): RegistrationResponseJSON & AuthenticationResponseJSON {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as { id?: unknown }).id !== 'string' ||
    !(value as { response?: unknown }).response ||
    typeof (value as { response: unknown }).response !== 'object'
  ) {
    throw new HttpError(400, 'request_invalid');
  }

  return value as RegistrationResponseJSON & AuthenticationResponseJSON;
}

function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) {
    throw new HttpError(400, 'request_invalid');
  }

  return value.trim();
}

export function authRouter(auth: AuthRuntime) {
  const router = Router();
  const { passkeys, config } = auth;

  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(auth.requireInitialized);
  router.use(rateLimit(auth.database, config));
  router.use(csrf(config));
  router.use(json({ limit: '32kb' }));
  router.use(accountRouter(auth));
  router.get('/session', async (request, response) => {
    request.session.csrf ??= randomBytes(32).toString('base64url');
    await saveSession(request);
    response.json(sessionView(request));
  });
  router.post('/passkeys/registration/options', async (request, response) => {
    const input = body(request, request.user ? [] : ['email']);

    if (request.user && !request.user.grantId) {
      requireFull(request.user);
    }

    const email = request.user ? undefined : normalizeEmail(input.email);
    const result = await passkeys.registrationOptions(request.sessionID, request.user, email);

    response.json(result);
  });
  router.post('/passkeys/registration/verify', async (request, response) => {
    if (request.user && !request.user.grantId) {
      requireFull(request.user);
    }

    const input = body(request, ['challengeId', 'response', 'label']);
    const result = await passkeys.register(
      request.sessionID,
      identifier(input.challengeId),
      webAuthnResponse(input.response),
      input.label === undefined ? 'Passkey' : label(input.label),
      request.user,
    );

    await establishSession(request, result, auth);
    let verification = {};

    if (result.level === 'unverified' && result.email) {
      const result1 = await auth.accounts.emailStart(request.sessionID, result);

      verification = result1;
    }

    response.status(201).json({ ...sessionView(request), ...verification });
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
      request.user?.grantId ? request.user : undefined,
    );

    if (request.user && request.user.id !== result.id) {
      throw new AuthHttpError(403, 'identity_mismatch');
    }

    const recovering = Boolean(request.user?.grantId);

    await establishSession(request, result, auth);
    if (recovering && result.level === 'full') {
      await auth.accounts.notify(result.email, 'Account recovery completed with a new passkey.');
    }

    response.json(sessionView(request));
  });
  router.post('/logout', async (request, response) => {
    body(request, []);
    await new Promise<void>((resolve, reject) =>
      request.session.destroy((error) => (error ? reject(new HttpError(503, 'session_unavailable')) : resolve())),
    );
    response.clearCookie(config.cookieName, { httpOnly: true, secure: config.secure, sameSite: 'strict', path: '/' });
    response.status(204).end();
  });
  router.use('/passkeys', (request, _response, next) => {
    try {
      requireFull(request.user);
      next();
    } catch (error) {
      next(error);
    }
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

  if (HttpError.is(error)) {
    next(error);

    return;
  }

  if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
    next(new HttpError(error.type === 'entity.too.large' ? 413 : 400, 'request_invalid'));

    return;
  }

  // Includes SQL/driver failures; neither the query nor its parameters leave the boundary.
  next(new HttpError(503, 'authentication_unavailable'));
};
