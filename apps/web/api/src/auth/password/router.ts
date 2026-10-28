import { registerRoutes } from '@visomi-stack/web-backend-shared';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import { requireAnonymousSession } from '../shared/http';

import { passwordContracts } from './contract';
import type { PasswordController } from './controller';

export function createPasswordRouter(controller: PasswordController): Router {
  const router = Router();

  registerRoutes(router, [
    {
      contract: passwordContracts.signUp,
      handler: controller.signUp.bind(controller),
      beforeValidation: [anonymousOnly],
    },
    {
      contract: passwordContracts.signIn,
      handler: controller.signIn.bind(controller),
      beforeValidation: [anonymousOnly],
    },
    {
      contract: passwordContracts.verifySignIn,
      handler: controller.verifySignIn.bind(controller),
      beforeValidation: [anonymousOnly],
    },
    { contract: passwordContracts.startReauthentication, handler: controller.startReauthentication.bind(controller) },
    {
      contract: passwordContracts.completeReauthentication,
      handler: controller.completeReauthentication.bind(controller),
    },
    { contract: passwordContracts.addPassword, handler: controller.addPassword.bind(controller) },
    { contract: passwordContracts.changePassword, handler: controller.changePassword.bind(controller) },
    { contract: passwordContracts.removePassword, handler: controller.removePassword.bind(controller) },
  ]);

  return router;
}

function anonymousOnly(request: Request, _response: Response, next: NextFunction): void {
  requireAnonymousSession(request);
  next();
}
