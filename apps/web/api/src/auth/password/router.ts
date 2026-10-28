import { registerRoute } from '@visomi-stack/web-backend-shared';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import { requireAnonymousSession } from '../shared/http';

import { passwordContracts } from './contract';
import type { PasswordController } from './controller';

export function createPasswordRouter(controller: PasswordController): Router {
  const router = Router();

  registerRoute(
    router,
    passwordContracts.signUp,
    (request, response, input) => controller.signUp(request, response, input),
    anonymousOnly,
  );
  registerRoute(
    router,
    passwordContracts.signIn,
    (request, response, input) => controller.signIn(request, response, input),
    anonymousOnly,
  );
  registerRoute(
    router,
    passwordContracts.verifySignIn,
    (request, response, input) => controller.verifySignIn(request, response, input),
    anonymousOnly,
  );
  registerRoute(router, passwordContracts.startReauthentication, (request, response, input) =>
    controller.startReauthentication(request, response, input),
  );
  registerRoute(router, passwordContracts.completeReauthentication, (request, response, input) =>
    controller.completeReauthentication(request, response, input),
  );
  registerRoute(router, passwordContracts.addPassword, (request, response, input) =>
    controller.addPassword(request, response, input),
  );
  registerRoute(router, passwordContracts.changePassword, (request, response, input) =>
    controller.changePassword(request, response, input),
  );
  registerRoute(router, passwordContracts.removePassword, (request, response, input) =>
    controller.removePassword(request, response, input),
  );

  return router;
}

function anonymousOnly(request: Request, _response: Response, next: NextFunction): void {
  requireAnonymousSession(request);
  next();
}
