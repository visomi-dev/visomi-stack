import { Router } from 'express';

import type { AuthRuntime } from '../runtime';

import { confirmTotp, regenerateRecoveryCodes, removeTotp, setupTotp } from './controller';

export function createTotpRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.post('/totp/setup', (request, response) => setupTotp(auth, request, response));
  router.post('/totp/confirm', (request, response) => confirmTotp(auth, request, response));
  router.delete('/totp', (request, response) => removeTotp(auth, request, response));
  router.post('/recovery-codes/regenerate', (request, response) => regenerateRecoveryCodes(auth, request, response));

  return router;
}
