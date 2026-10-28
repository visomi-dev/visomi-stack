import type { Request, Response } from 'express';

import { normalizeEmail } from '../email/normalization';
import type { AuthRuntime } from '../runtime';
import {
  body,
  identifier,
  requireAnonymousSession,
  requirePrincipal,
  sendAuthenticationResult,
  text,
} from '../shared/http';

export async function requestApproval(auth: AuthRuntime, request: Request, response: Response) {
  requireAnonymousSession(request);
  const input = body(request, ['email']);
  const pending = await auth.devices.request(request.sessionID, normalizeEmail(input.email));

  response.status(201).json(pending);
}

export async function getApprovalStatus(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['requestId']);
  const state = await auth.devices.status(request.sessionID, identifier(input.requestId));

  response.json(state);
}

export async function reviewApproval(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['requestId']);
  const state = await auth.devices.review(request.sessionID, requirePrincipal(request), identifier(input.requestId));

  response.json(state);
}

export async function decideApproval(
  auth: AuthRuntime,
  request: Request,
  response: Response,
  operation: 'approve' | 'deny',
) {
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

export async function cancelApproval(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['requestId']);

  await auth.devices.cancel(request.sessionID, identifier(input.requestId));
  response.status(204).end();
}

export async function consumeApproval(auth: AuthRuntime, request: Request, response: Response) {
  const input = body(request, ['requestId', 'userCode']);
  const user = await auth.devices.consume(request.sessionID, identifier(input.requestId), text(input.userCode, 6));

  await sendAuthenticationResult(auth, request, response, user);
}
