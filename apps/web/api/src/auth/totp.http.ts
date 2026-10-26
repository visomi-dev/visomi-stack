import { Router } from 'express';
import type { Request, Response } from 'express';

import { body, identifier, requirePrincipal, sendAuthenticationResult, text } from './http';
import type { AuthRuntime } from './runtime';

export function createTotpRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.post('/totp/setup', (request, response) => setupTotp(auth, request, response));
  router.post('/totp/confirm', (request, response) => confirmTotp(auth, request, response));
  router.delete('/totp', (request, response) => removeTotp(auth, request, response));
  router.post('/recovery-codes/regenerate', (request, response) => regenerateRecoveryCodes(auth, request, response));

  return router;
}

async function setupTotp(auth: AuthRuntime, request: Request, response: Response) {
  body(request, []);
  const setup = await auth.accounts.factors.setup(request.sessionID, requirePrincipal(request));

  response.status(201).json(setup);
}

async function confirmTotp(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['enrollmentId', 'code']);
  const user = requirePrincipal(request);
  const id = identifier(input.enrollmentId);

  await auth.accounts.flows.limit('totp-confirm', id, 5);
  const confirmed = await auth.accounts.factors.confirm(request.sessionID, user, id, text(input.code, 6));
  const notificationSent = await auth.accounts.notify(user.email, 'totp_enabled');

  await sendAuthenticationResult(auth, request, response, confirmed.user, {
    recoveryCodes: confirmed.codes,
    notificationSent,
  });
}

async function removeTotp(auth: AuthRuntime, request: Request, response: Response) {
  const user = requirePrincipal(request);
  const updated = await auth.accounts.factors.remove(request.sessionID, user);
  const notificationSent = await auth.accounts.notify(user.email, 'totp_disabled');

  await sendAuthenticationResult(auth, request, response, updated, { notificationSent });
}

async function regenerateRecoveryCodes(auth: AuthRuntime, request: Request, response: Response) {
  body(request, []);
  const updated = await auth.accounts.factors.regenerate(request.sessionID, requirePrincipal(request));

  await sendAuthenticationResult(auth, request, response, updated.user, { recoveryCodes: updated.codes });
}
