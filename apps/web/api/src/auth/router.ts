import type { NextFunction, Request, Response } from 'express';
import { Router, json } from 'express';

import { createDeviceRouter } from './devices/router';
import { createEmailRouter } from './email/router';
import { createGoogleRouter } from './google/router';
import { createMethodRouter } from './methods/router';
import { createPasskeyRouter } from './passkeys/router';
import { createPasswordRouter } from './password/router';
import { createRecoveryRouter } from './recovery/router';
import type { AuthRuntime } from './runtime';
import { createSessionRouter } from './sessions/router';
import { csrf, rateLimit } from './shared/security';
import { createTotpRouter } from './totp/router';

export { authErrorHandler, saveSession } from './shared/http';

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
  router.use(createMethodRouter(auth));
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
