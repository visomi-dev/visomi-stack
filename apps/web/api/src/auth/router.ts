import { Router, json } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { createPasswordRouter } from './password.http';
import { createEmailRouter } from './email.http';
import { createGoogleRouter } from './google.http';
import { createTotpRouter } from './totp.http';
import { createRecoveryRouter } from './recovery.http';
import { createDeviceRouter } from './devices.http';
import { createSessionRouter } from './sessions.http';
import { createPasskeyRouter } from './passkeys.http';
import type { AuthRuntime } from './runtime';
import { csrf, rateLimit } from './security';

export { authErrorHandler, saveSession } from './http';

export function createAuthRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.use(disableCaching);
  router.use(auth.requireInitialized);
  router.use(rateLimit(auth.requestLimits, auth.config));
  router.use(csrf(auth.config));
  router.use(json({ limit: '32kb' }));
  router.get('/providers', (request, response) => getProviders(auth, request, response));
  router.use(createPasswordRouter(auth));
  router.use(createEmailRouter(auth));
  router.use(createGoogleRouter(auth));
  router.use(createTotpRouter(auth));
  router.use(createRecoveryRouter(auth));
  router.use(createDeviceRouter(auth));
  router.use(createSessionRouter(auth));
  router.use(createPasskeyRouter(auth));

  return router;
}

function disableCaching(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Cache-Control', 'no-store');
  next();
}

function getProviders(auth: AuthRuntime, _request: Request, response: Response): void {
  response.json({
    passkey: true,
    password: true,
    google: { enabled: Boolean(auth.config.googleClientId), clientId: auth.config.googleClientId ?? null },
    totp: Boolean(auth.config.totpKey),
  });
}
