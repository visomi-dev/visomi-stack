import type { Request, Response } from 'express';

import type { AuthRuntime } from '../runtime';
import { body, identifier, requirePrincipal, sendAuthenticationResult, text } from '../shared/http';

export async function setupTotp(auth: AuthRuntime, request: Request, response: Response) {
  body(request, []);
  const setup = await auth.factors.setup(request.sessionID, requirePrincipal(request));

  response.status(201).json(setup);
}

export async function confirmTotp(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['enrollmentId', 'code']);
  const user = requirePrincipal(request);
  const id = identifier(input.enrollmentId);

  await auth.flows.limit('totp-confirm', id, 5);
  const confirmed = await auth.factors.confirm(request.sessionID, user, id, text(input.code, 6));
  const notificationSent = await auth.notifications.notify(user.email, 'totp_enabled');

  await sendAuthenticationResult(auth, request, response, confirmed.user, {
    recoveryCodes: confirmed.codes,
    notificationSent,
  });
}

export async function removeTotp(auth: AuthRuntime, request: Request, response: Response) {
  const user = requirePrincipal(request);
  const updated = await auth.factors.remove(request.sessionID, user);
  const notificationSent = await auth.notifications.notify(user.email, 'totp_disabled');

  await sendAuthenticationResult(auth, request, response, updated, { notificationSent });
}

export async function regenerateRecoveryCodes(auth: AuthRuntime, request: Request, response: Response) {
  body(request, []);
  const updated = await auth.factors.regenerate(request.sessionID, requirePrincipal(request));

  await sendAuthenticationResult(auth, request, response, updated.user, { recoveryCodes: updated.codes });
}
