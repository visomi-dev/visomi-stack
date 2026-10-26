import { Router } from 'express';
import type { Request, Response } from 'express';

import { body, identifier, requireAnonymousSession, requirePrincipal, sendAuthenticationResult, text } from './http';
import type { AuthRuntime } from './runtime';
import { normalizeEmail } from './secrets';

export function createDeviceRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.post('/device-approval/request', (request, response) => requestApproval(auth, request, response));
  router.post('/device-approval/status', (request, response) => getApprovalStatus(auth, request, response));
  router.post('/device-approval/review', (request, response) => reviewApproval(auth, request, response));
  router.post('/device-approval/approve', (request, response) => decideApproval(auth, request, response, 'approve'));
  router.post('/device-approval/deny', (request, response) => decideApproval(auth, request, response, 'deny'));
  router.post('/device-approval/cancel', (request, response) => cancelApproval(auth, request, response));
  router.post('/device-approval/consume', (request, response) => consumeApproval(auth, request, response));

  return router;
}

async function requestApproval(auth: AuthRuntime, request: Request, response: Response) {
  requireAnonymousSession(request);
  const input = body(request, ['email']);
  const pending = await auth.devices.request(request.sessionID, normalizeEmail(input.email));

  response.status(201).json(pending);
}

async function getApprovalStatus(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['requestId']);
  const state = await auth.devices.status(request.sessionID, identifier(input.requestId));

  response.json(state);
}

async function reviewApproval(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['requestId']);
  const state = await auth.devices.review(request.sessionID, requirePrincipal(request), identifier(input.requestId));

  response.json(state);
}

async function decideApproval(auth: AuthRuntime, request: Request, response: Response, operation: 'approve' | 'deny') {
  const input = body(request, ['requestId', 'userCode']);

  await auth.devices.decide(
    request.sessionID,
    requirePrincipal(request),
    identifier(input.requestId),
    operation === 'approve',
    text(input.userCode, 6),
  );
  response.status(204).end();
}

async function cancelApproval(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['requestId']);

  await auth.devices.cancel(request.sessionID, identifier(input.requestId));
  response.status(204).end();
}

async function consumeApproval(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['requestId', 'userCode']);
  const user = await auth.devices.consume(request.sessionID, identifier(input.requestId), text(input.userCode, 6));

  await sendAuthenticationResult(auth, request, response, user);
}
