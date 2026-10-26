import { Router } from 'express';
import type { Request, Response } from 'express';

import { body, identifier, requirePrincipal, sendAuthenticationResult, text } from './http';
import type { AuthRuntime } from './runtime';
import { normalizeEmail } from './secrets';

export function createEmailRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.post('/email/request', (request, response) => requestVerification(auth, request, response));
  router.post('/email/verify', (request, response) => verifyEmail(auth, request, response));
  router.post('/email/change/request', (request, response) => requestEmailChange(auth, request, response));
  router.post('/email/change/verify', (request, response) => verifyEmailChange(auth, request, response));
  router.post('/challenges/resend', (request, response) => resendChallenge(auth, request, response));

  return router;
}

async function requestVerification(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['email']);
  const pending = await auth.accounts.emailStart(
    request.sessionID,
    requirePrincipal(request),
    input.email === undefined ? undefined : normalizeEmail(input.email),
  );

  response.status(202).json(pending);
}

async function verifyEmail(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['flowId', 'code']);
  const verified = await auth.accounts.emailComplete(
    request.sessionID,
    requirePrincipal(request),
    identifier(input.flowId),
    text(input.code, 6),
  );

  await sendAuthenticationResult(auth, request, response, verified.user);
}

async function requestEmailChange(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['email']);
  const pending = await auth.accounts.emailStart(
    request.sessionID,
    requirePrincipal(request),
    normalizeEmail(input.email),
    true,
  );

  response.status(202).json(pending);
}

async function verifyEmailChange(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['flowId', 'code']);
  const changed = await auth.accounts.emailComplete(
    request.sessionID,
    requirePrincipal(request),
    identifier(input.flowId),
    text(input.code, 6),
    true,
  );
  const notificationSent = await auth.accounts.notify(changed.previousEmail, 'email_changed');

  await sendAuthenticationResult(auth, request, response, changed.user, { notificationSent });
}

async function resendChallenge(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['flowId']);
  const pending = await auth.accounts.flows.resend(request.sessionID, identifier(input.flowId));

  response.status(202).json(pending);
}
