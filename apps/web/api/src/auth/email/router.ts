import { Router } from 'express';

import type { AuthRuntime } from '../runtime';

import { requestEmailChange, requestVerification, resendChallenge, verifyEmail, verifyEmailChange } from './controller';

export function createEmailRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.post('/email/request', (request, response) => requestVerification(auth, request, response));
  router.post('/email/verify', (request, response) => verifyEmail(auth, request, response));
  router.post('/email/change/request', (request, response) => requestEmailChange(auth, request, response));
  router.post('/email/change/verify', (request, response) => verifyEmailChange(auth, request, response));
  router.post('/challenges/resend', (request, response) => resendChallenge(auth, request, response));

  return router;
}
