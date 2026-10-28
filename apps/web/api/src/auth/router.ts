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
  router.use(createPasswordRouter(auth.controllers.password, auth.authenticated));
  router.use(createEmailRouter(auth.controllers.email, auth.authenticated));
  router.use(createGoogleRouter(auth.controllers.google, auth.authenticated));
  router.use(createTotpRouter(auth.controllers.totp, auth.authenticated));
  router.use(createRecoveryRouter(auth.controllers.recovery));
  router.use(createDeviceRouter(auth.controllers.devices, auth.authenticated));
  router.use(createMethodRouter(auth.controllers.methods, auth.authenticated));
  router.use(createSessionRouter(auth.controllers.sessions, auth.authenticated));
  router.use(createPasskeyRouter(auth.controllers.passkeys, auth.authenticated));

  return router;
}

function disableCaching(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Cache-Control', 'no-store');
  next();
}
