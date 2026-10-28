import type { Request, Response } from 'express';

import type { AuthRuntime } from '../runtime';
import { body, identifier, requirePrincipal, sendAuthenticationResult, text } from '../shared/http';

import { normalizeEmail } from './normalization';

export async function requestVerification(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['email']);
  const pending = await auth.email.emailStart(
    request.sessionID,
    requirePrincipal(request),
    input.email === undefined ? undefined : normalizeEmail(input.email),
  );

  response.status(202).json(pending);
}

export async function verifyEmail(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['flowId', 'code']);
  const verified = await auth.email.emailComplete(
    request.sessionID,
    requirePrincipal(request),
    identifier(input.flowId),
    text(input.code, 6),
  );

  await sendAuthenticationResult(auth, request, response, verified.user);
}

export async function requestEmailChange(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['email']);
  const pending = await auth.email.emailStart(
    request.sessionID,
    requirePrincipal(request),
    normalizeEmail(input.email),
    true,
  );

  response.status(202).json(pending);
}

export async function verifyEmailChange(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['flowId', 'code']);
  const changed = await auth.email.emailComplete(
    request.sessionID,
    requirePrincipal(request),
    identifier(input.flowId),
    text(input.code, 6),
    true,
  );
  const notificationSent = await auth.notifications.notify(changed.previousEmail, 'email_changed');

  await sendAuthenticationResult(auth, request, response, changed.user, { notificationSent });
}

export async function resendChallenge(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['flowId']);
  const pending = await auth.flows.resend(request.sessionID, identifier(input.flowId));

  response.status(202).json(pending);
}
