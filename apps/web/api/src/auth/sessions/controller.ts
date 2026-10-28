import { randomBytes } from 'node:crypto';

import type { Request, Response } from 'express';

import type { AuthRuntime } from '../runtime';
import { body, requirePrincipal, saveSession, sendAuthenticationResult, sessionView, text } from '../shared/http';

export async function listSessions(auth: AuthRuntime, request: Request, response: Response) {
  const sessions = await auth.sessions.listSessions(request.sessionID, requirePrincipal(request));

  response.json({ sessions });
}

export async function closeSession(auth: AuthRuntime, request: Request, response: Response) {
  const self = await auth.sessions.closeSessions(
    request.sessionID,
    requirePrincipal(request),
    text(request.params.id, 64),
  );

  if (self) {
    response.clearCookie(auth.config.cookieName, { path: '/' });
  }

  response.status(204).end();
}

export async function revokeOtherSessions(auth: AuthRuntime, request: Request, response: Response) {
  body(request, []);
  await auth.sessions.closeSessions(request.sessionID, requirePrincipal(request));
  response.status(204).end();
}

export async function getSession(request: Request, response: Response) {
  request.session.csrf ??= randomBytes(32).toString('base64url');
  await saveSession(request);
  response.json(sessionView(request));
}

export async function logout(auth: AuthRuntime, request: Request, response: Response) {
  body(request, []);

  await sendAuthenticationResult(auth, request, response, null);
}
