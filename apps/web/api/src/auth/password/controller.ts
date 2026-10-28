import type { Request, Response } from 'express';

import { normalizeEmail } from '../email/normalization';
import type { AuthRuntime } from '../runtime';
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
} from '../shared/http';

export async function signUp(auth: AuthRuntime, request: Request, response: Response) {
  requireAnonymousSession(request);
  const input = body(request, ['email', 'password']);
  const user = await auth.password.signup(request.sessionID, normalizeEmail(input.email), text(input.password));

  await establishSession(request, user, auth);
  const verification = await auth.email.emailStart(request.sessionID, user);

  response.status(201).json({ ...sessionView(request), ...verification });
}

export async function signIn(auth: AuthRuntime, request: Request, response: Response) {
  requireAnonymousSession(request);
  const input = body(request, ['email', 'password']);
  const pending = await auth.password.signIn(request.sessionID, normalizeEmail(input.email), text(input.password));

  response.status(202).json(pending);
}

export async function verifySignIn(auth: AuthRuntime, request: Request, response: Response) {
  requireAnonymousSession(request);
  const input = body(request, ['flowId', 'factor']);
  const user = await auth.password.loginComplete(request.sessionID, identifier(input.flowId), factor(input.factor));

  await sendAuthenticationResult(auth, request, response, user);
}

export async function startReauthentication(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['password']);
  const pending = await auth.password.reauthStart(request.sessionID, requirePrincipal(request), text(input.password));

  response.status(202).json(pending);
}

export async function completeReauthentication(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['flowId', 'factor']);
  const user = await auth.password.reauthComplete(
    request.sessionID,
    requirePrincipal(request),
    identifier(input.flowId),
    factor(input.factor),
  );

  await sendAuthenticationResult(auth, request, response, user);
}

export async function updatePassword(
  auth: AuthRuntime,
  request: Request,
  response: Response,
  operation: 'add' | 'change' | 'remove',
) {
  const input = body(request, operation === 'remove' ? [] : ['password']);
  const user = requirePrincipal(request);
  const updated = await auth.password.passwordChange(
    request.sessionID,
    user,
    operation === 'remove' ? null : text(input.password),
    operation === 'add',
  );
  const notificationSent = await auth.notifications.notify(user.email, 'password_changed');

  await sendAuthenticationResult(auth, request, response, updated, { notificationSent });
}
