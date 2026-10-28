import { AuthHttpError } from '@visomi-stack/web-backend-shared';
import type { Request, Response } from 'express';

import type { AuthRuntime } from '../runtime';
import {
  body,
  identifier,
  requireAnonymousSession,
  requirePrincipal,
  sendAuthenticationResult,
  text,
} from '../shared/http';

export async function startGoogle(auth: AuthRuntime, request: Request, response: Response) {
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

export async function completeGoogle(auth: AuthRuntime, request: Request, response: Response) {
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

export async function verifyGoogleEmail(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['flowId', 'code']);
  const user = await auth.google.emailComplete(
    request.sessionID,
    identifier(input.flowId),
    text(input.code, 6),
    request.user,
  );

  await sendAuthenticationResult(auth, request, response, user);
}

export async function unlinkGoogle(auth: AuthRuntime, request: Request, response: Response) {
  const user = requirePrincipal(request);
  const updated = await auth.google.unlink(request.sessionID, user, identifier(request.params.id));
  const notificationSent = await auth.notifications.notify(user.email, 'google_unlinked');

  await sendAuthenticationResult(auth, request, response, updated, { notificationSent });
}
