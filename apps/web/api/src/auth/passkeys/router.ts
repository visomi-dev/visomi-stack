import { Router } from 'express';

import type { AuthRuntime } from '../runtime';

import {
  authenticatePasskey,
  authenticationOptions,
  listPasskeys,
  registerPasskey,
  registrationOptions,
  renamePasskey,
  requireVerifiedSession,
  revokePasskey,
} from './controller';

export function createPasskeyRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.post('/passkeys/registration/options', (request, response) => registrationOptions(auth, request, response));
  router.post('/passkeys/registration/verify', (request, response) => registerPasskey(auth, request, response));
  router.post('/passkeys/authentication/options', (request, response) =>
    authenticationOptions(auth, request, response),
  );
  router.post('/passkeys/authentication/verify', (request, response) => authenticatePasskey(auth, request, response));
  router.use('/passkeys', requireVerifiedSession);
  router.get('/passkeys', (request, response) => listPasskeys(auth, request, response));
  router.patch('/passkeys/:id', (request, response) => renamePasskey(auth, request, response));
  router.delete('/passkeys/:id', (request, response) => revokePasskey(auth, request, response));

  return router;
}
