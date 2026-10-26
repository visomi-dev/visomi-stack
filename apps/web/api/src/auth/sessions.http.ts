import { randomBytes } from 'node:crypto';

import { Router } from 'express';
import type { Request, Response } from 'express';

import { body, requirePrincipal, saveSession, sendAuthenticationResult, sessionView, text } from './http';
import type { AuthRuntime } from './runtime';

export function createSessionRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.get('/methods', (request, response) => getMethods(auth, request, response));
  router.get('/sessions', (request, response) => listSessions(auth, request, response));
  router.delete('/sessions/:id', (request, response) => closeSession(auth, request, response));
  router.post('/sessions/revoke-others', (request, response) => revokeOtherSessions(auth, request, response));
  router.get('/session', getSession);
  router.post('/logout', (request, response) => logout(auth, request, response));

  return router;
}

async function getMethods(auth: AuthRuntime, request: Request, response: Response) {
  const methods = await auth.accounts.overview(requirePrincipal(request));

  response.json(methods);
}

async function listSessions(auth: AuthRuntime, request: Request, response: Response) {
  const sessions = await auth.accounts.listSessions(request.sessionID, requirePrincipal(request));

  response.json({ sessions });
}

async function closeSession(auth: AuthRuntime, request: Request, response: Response) {
  const self = await auth.accounts.closeSessions(
    request.sessionID,
    requirePrincipal(request),
    text(request.params.id, 64),
  );

  if (self) {
    response.clearCookie(auth.config.cookieName, { path: '/' });
  }

  response.status(204).end();
}

async function revokeOtherSessions(auth: AuthRuntime, request: Request, response: Response) {
  body(request, []);
  await auth.accounts.closeSessions(request.sessionID, requirePrincipal(request));
  response.status(204).end();
}

async function getSession(request: Request, response: Response) {
  request.session.csrf ??= randomBytes(32).toString('base64url');
  await saveSession(request);
  response.json(sessionView(request));
}

async function logout(auth: AuthRuntime, request: Request, response: Response) {
  body(request, []);

  await sendAuthenticationResult(auth, request, response, null);
}
