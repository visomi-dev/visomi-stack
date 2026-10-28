import { Router } from 'express';

import type { AuthRuntime } from '../runtime';

import { completePassword, requestRecovery, stagePassword, verifyRecovery } from './controller';

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
