import { AuthHttpError } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';
import type { Request, Response } from 'express';

import { body, identifier, requireAnonymousSession, requirePrincipal, sendAuthenticationResult, text } from './http';
import type { AuthRuntime } from './runtime';

export function createGoogleRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.post('/google/start', (request, response) => startGoogle(auth, request, response));
  router.post('/google/complete', (request, response) => completeGoogle(auth, request, response));
  router.post('/google/email/verify', (request, response) => verifyGoogleEmail(auth, request, response));
  router.delete('/google/:id', (request, response) => unlinkGoogle(auth, request, response));

  return router;
}

async function startGoogle(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['intent']);
  const intent = input.intent ?? 'login';

  if (!['login', 'link', 'reauth'].includes(String(intent))) {
    throw new AuthHttpError(403, 'intent_invalid');
  }

  if (intent === 'login') {
    requireAnonymousSession(request);
  }

  const pending = await auth.google.start(request.sessionID, intent as 'login' | 'link' | 'reauth', request.user);

  response.status(201).json(pending);
}

async function completeGoogle(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['flowId', 'idToken']);
  const completed = await auth.google.complete(
    request.sessionID,
    identifier(input.flowId),
    text(input.idToken, 16384),
    request.user,
  );

  if (completed.pending) {
    response.status(202).json(completed.pending);
  } else {
    await sendAuthenticationResult(auth, request, response, completed.user!);
  }
}

async function verifyGoogleEmail(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['flowId', 'code']);
  const user = await auth.google.emailComplete(
    request.sessionID,
    identifier(input.flowId),
    text(input.code, 6),
    request.user,
  );

  await sendAuthenticationResult(auth, request, response, user);
}

async function unlinkGoogle(auth: AuthRuntime, request: Request, response: Response) {
  const user = requirePrincipal(request);
  const updated = await auth.google.unlink(request.sessionID, user, identifier(request.params.id));
  const notificationSent = await auth.accounts.notify(user.email, 'google_unlinked');

  await sendAuthenticationResult(auth, request, response, updated, { notificationSent });
}
