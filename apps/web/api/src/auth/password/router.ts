import { Router } from 'express';

import type { AuthRuntime } from '../runtime';

import {
  completeReauthentication,
  signIn,
  signUp,
  startReauthentication,
  updatePassword,
  verifySignIn,
} from './controller';

export function createPasswordRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.post('/password/sign-up', (request, response) => signUp(auth, request, response));
  router.post('/password/sign-in', (request, response) => signIn(auth, request, response));
  router.post('/password/verify', (request, response) => verifySignIn(auth, request, response));
  router.post('/reauth/password/start', (request, response) => startReauthentication(auth, request, response));
  router.post('/reauth/password/complete', (request, response) => completeReauthentication(auth, request, response));
  router.post('/password/add', (request, response) => updatePassword(auth, request, response, 'add'));
  router.post('/password/change', (request, response) => updatePassword(auth, request, response, 'change'));
  router.post('/password/remove', (request, response) => updatePassword(auth, request, response, 'remove'));

  return router;
}
