import { Router } from 'express';
import type { Request, Response } from 'express';

import { body, factor, identifier, requirePrincipal, sendAuthenticationResult, text } from './http';
import type { AuthRuntime } from './runtime';
import { normalizeEmail } from './secrets';

export function createRecoveryRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.post('/recovery/request', (request, response) => requestRecovery(auth, request, response, false));
  router.post('/recovery/verify', (request, response) => verifyRecovery(auth, request, response, false));
  router.post('/password/reset/request', (request, response) => requestRecovery(auth, request, response, true));
  router.post('/password/reset/complete', (request, response) => verifyRecovery(auth, request, response, true));
  router.post('/recovery/password', (request, response) => stagePassword(auth, request, response));
  router.post('/recovery/password/complete', (request, response) => completePassword(auth, request, response));

  return router;
}

async function requestRecovery(auth: AuthRuntime, request: Request, response: Response, reset: boolean) {
  const input = body(request, ['email']);
  const pending = await auth.recovery.request(request.sessionID, normalizeEmail(input.email), reset, request.user);

  response.status(202).json(pending);
}

async function verifyRecovery(auth: AuthRuntime, request: Request, response: Response, reset: boolean) {
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
  const notificationSent = await auth.accounts.notify(
    recovered.email,
    reset ? 'password_reset' : 'recovery_authorized',
  );

  if (!user && !request.user) {
    response.json({ passwordReset: true, notificationSent });
  } else {
    await sendAuthenticationResult(auth, request, response, user, { notificationSent });
  }
}

async function stagePassword(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['password']);
  const pending = await auth.recovery.password(request.sessionID, requirePrincipal(request), text(input.password));

  response.status(202).json(pending);
}

async function completePassword(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['flowId', 'password', 'factor']);
  const user = await auth.recovery.passwordComplete(
    request.sessionID,
    requirePrincipal(request),
    identifier(input.flowId),
    text(input.password),
    factor(input.factor),
  );
  const notificationSent = await auth.accounts.notify(user.email, 'password_recovered');

  await sendAuthenticationResult(auth, request, response, user, { notificationSent });
}
