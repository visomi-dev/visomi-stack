import { Router } from 'express';

import type { AuthRuntime } from '../runtime';

import { closeSession, getSession, listSessions, logout, revokeOtherSessions } from './controller';

export function createSessionRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.get('/sessions', (request, response) => listSessions(auth, request, response));
  router.delete('/sessions/:id', (request, response) => closeSession(auth, request, response));
  router.post('/sessions/revoke-others', (request, response) => revokeOtherSessions(auth, request, response));
  router.get('/session', getSession);
  router.post('/logout', (request, response) => logout(auth, request, response));

  return router;
}
