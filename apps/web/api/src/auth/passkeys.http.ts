import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';

import { body, identifier, establishSession, sessionView } from './http';
import type { AuthRuntime } from './runtime';
import { normalizeEmail } from './secrets';
import { requireFull } from './identity';

export function createPasskeyRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.post('/passkeys/registration/options', (request, response) => registrationOptions(auth, request, response));
  router.post('/passkeys/registration/verify', (request, response) => registerPasskey(auth, request, response));
  router.post('/passkeys/authentication/options', (request, response) =>
    authenticationOptions(auth, request, response),
  );
  router.post('/passkeys/authentication/verify', (request, response) => authenticatePasskey(auth, request, response));
  router.use('/passkeys', requireVerifiedSession);
  router.get('/passkeys', (request, response) => listPasskeys(auth, request, response));
  router.patch('/passkeys/:id', (request, response) => renamePasskey(auth, request, response));
  router.delete('/passkeys/:id', (request, response) => revokePasskey(auth, request, response));

  return router;
}

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

async function registrationOptions(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, request.user ? [] : ['email']);

  if (request.user && !request.user.grantId) {
    requireFull(request.user);
  }

  const email = request.user ? undefined : normalizeEmail(input.email);
  const result = await auth.passkeys.registrationOptions(request.sessionID, request.user, email);

  response.json(result);
}

async function registerPasskey(auth: AuthRuntime, request: Request, response: Response) {
  if (request.user && !request.user.grantId) {
    requireFull(request.user);
  }

  const input = body(request, ['challengeId', 'response', 'label']);
  const result = await auth.passkeys.register(
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
}

async function authenticationOptions(auth: AuthRuntime, request: Request, response: Response) {
  body(request, []);
  const result = await auth.passkeys.authenticationOptions(request.sessionID);

  response.json(result);
}

async function authenticatePasskey(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['challengeId', 'response']);
  const result = await auth.passkeys.authenticate(
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
    await auth.accounts.notify(result.email, 'passkey_recovered');
  }

  response.json(sessionView(request));
}

function requireVerifiedSession(request: Request, _response: Response, next: NextFunction) {
  try {
    requireFull(request.user);
    next();
  } catch (error) {
    next(error);
  }
}

async function listPasskeys(auth: AuthRuntime, request: Request, response: Response) {
  const result = await auth.passkeys.list(request.user!);

  response.json({ credentials: result });
}

async function renamePasskey(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['label']);

  await auth.passkeys.rename(request.sessionID, request.user!, identifier(request.params.id), label(input.label));
  response.status(204).end();
}

async function revokePasskey(auth: AuthRuntime, request: Request, response: Response) {
  await auth.passkeys.revoke(request.sessionID, request.user!, identifier(request.params.id));
  response.status(204).end();
}
