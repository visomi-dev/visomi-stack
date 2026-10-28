import type { Request, Response } from 'express';

import { normalizeEmail } from '../email/normalization';
import type { AuthRuntime } from '../runtime';
import { body, factor, identifier, requirePrincipal, sendAuthenticationResult, text } from '../shared/http';

export async function requestRecovery(auth: AuthRuntime, request: Request, response: Response, reset: boolean) {
  const input = body(request, ['email']);
  const pending = await auth.recovery.request(request.sessionID, normalizeEmail(input.email), reset, request.user);

  response.status(202).json(pending);
}

export async function verifyRecovery(auth: AuthRuntime, request: Request, response: Response, reset: boolean) {
  const input = body(request, reset ? ['flowId', 'code', 'factor', 'password'] : ['flowId', 'code', 'factor']);
  const recovered = await auth.recovery.verify(
    request.sessionID,
    identifier(input.flowId),
    text(input.code, 6),
    input.factor === undefined ? undefined : factor(input.factor),
    reset ? text(input.password) : undefined,
    request.user,
  );
  const user = recovered.user;
  const notificationSent = await auth.notifications.notify(
    recovered.email,
    reset ? 'password_reset' : 'recovery_authorized',
  );

  if (!user && !request.user) {
    response.json({ passwordReset: true, notificationSent });
  } else {
    await sendAuthenticationResult(auth, request, response, user, { notificationSent });
  }
}

export async function stagePassword(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['password']);
  const pending = await auth.recovery.password(request.sessionID, requirePrincipal(request), text(input.password));

  response.status(202).json(pending);
}

export async function completePassword(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['flowId', 'password', 'factor']);
  const user = await auth.recovery.passwordComplete(
    request.sessionID,
    requirePrincipal(request),
    identifier(input.flowId),
    text(input.password),
    factor(input.factor),
  );
  const notificationSent = await auth.notifications.notify(user.email, 'password_recovered');

  await sendAuthenticationResult(auth, request, response, user, { notificationSent });
}
