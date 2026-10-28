import { Router } from 'express';

import type { AuthRuntime } from '../runtime';

import { completeGoogle, startGoogle, unlinkGoogle, verifyGoogleEmail } from './controller';

export function createGoogleRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.post('/google/start', (request, response) => startGoogle(auth, request, response));
  router.post('/google/complete', (request, response) => completeGoogle(auth, request, response));
  router.post('/google/email/verify', (request, response) => verifyGoogleEmail(auth, request, response));
  router.delete('/google/:id', (request, response) => unlinkGoogle(auth, request, response));

  return router;
}
