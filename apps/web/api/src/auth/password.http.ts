import { Router } from 'express';
import type { Request, Response } from 'express';

import {
  body,
  establishSession,
  factor,
  identifier,
  requireAnonymousSession,
  requirePrincipal,
  sendAuthenticationResult,
  sessionView,
  text,
} from './http';
import type { AuthRuntime } from './runtime';
import { normalizeEmail } from './secrets';

export function createPasswordRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.post('/password/sign-up', (request, response) => signUp(auth, request, response));
  router.post('/password/sign-in', (request, response) => signIn(auth, request, response));
  router.post('/password/verify', (request, response) => verifySignIn(auth, request, response));
  router.post('/reauth/password/start', (request, response) => startReauthentication(auth, request, response));
  router.post('/reauth/password/complete', (request, response) => completeReauthentication(auth, request, response));
  router.post('/password/add', (request, response) => updatePassword(auth, request, response, 'add'));
  router.post('/password/change', (request, response) => updatePassword(auth, request, response, 'change'));
  router.post('/password/remove', (request, response) => updatePassword(auth, request, response, 'remove'));

  return router;
}

async function signUp(auth: AuthRuntime, request: Request, response: Response) {
  requireAnonymousSession(request);
  const input = body(request, ['email', 'password']);
  const user = await auth.accounts.signup(request.sessionID, normalizeEmail(input.email), text(input.password));

  await establishSession(request, user, auth);
  const verification = await auth.accounts.emailStart(request.sessionID, user);

  response.status(201).json({ ...sessionView(request), ...verification });
}

async function signIn(auth: AuthRuntime, request: Request, response: Response) {
  requireAnonymousSession(request);
  const input = body(request, ['email', 'password']);
  const pending = await auth.accounts.signIn(request.sessionID, normalizeEmail(input.email), text(input.password));

  response.status(202).json(pending);
}

async function verifySignIn(auth: AuthRuntime, request: Request, response: Response) {
  requireAnonymousSession(request);
  const input = body(request, ['flowId', 'factor']);
  const user = await auth.accounts.loginComplete(request.sessionID, identifier(input.flowId), factor(input.factor));

  await sendAuthenticationResult(auth, request, response, user);
}

async function startReauthentication(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['password']);
  const pending = await auth.accounts.reauthStart(request.sessionID, requirePrincipal(request), text(input.password));

  response.status(202).json(pending);
}

async function completeReauthentication(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['flowId', 'factor']);
  const user = await auth.accounts.reauthComplete(
    request.sessionID,
    requirePrincipal(request),
    identifier(input.flowId),
    factor(input.factor),
  );

  await sendAuthenticationResult(auth, request, response, user);
}

async function updatePassword(
  auth: AuthRuntime,
  request: Request,
  response: Response,
  operation: 'add' | 'change' | 'remove',
) {
  const input = body(request, operation === 'remove' ? [] : ['password']);
  const user = requirePrincipal(request);
  const updated = await auth.accounts.passwordChange(
    request.sessionID,
    user,
    operation === 'remove' ? null : text(input.password),
    operation === 'add',
  );
  const notificationSent = await auth.accounts.notify(user.email, 'password_changed');

  await sendAuthenticationResult(auth, request, response, updated, { notificationSent });
}
