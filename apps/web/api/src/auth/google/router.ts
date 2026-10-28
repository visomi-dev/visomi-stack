import { routes } from '@visomi-stack/web-backend-shared';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import { anonymous, type Authorization } from '../shared/authorization';

import { googleContracts } from './contract';
import type { GoogleController } from './controller';

export function createGoogleRouter(
  controller: GoogleController,
  authenticated: Authorization['authenticated'],
): Router {
  const router = Router();
  const full = authenticated();

  routes.register(
    router,
    [
      { contract: googleContracts.startGoogle, handler: controller.startGoogle, beforeValidation: [startAccess] },
      { contract: googleContracts.completeGoogle, handler: controller.completeGoogle },
      { contract: googleContracts.verifyGoogleEmail, handler: controller.verifyGoogleEmail },
      { contract: googleContracts.unlinkGoogle, handler: controller.unlinkGoogle, beforeValidation: [full] },
    ],
    controller,
  );

  return router;

  function startAccess(request: Request, response: Response, next: NextFunction) {
    const intent: unknown = request.body?.intent;

    if (intent == null || intent === 'login') {
      anonymous(request, response, next);
    } else if (intent === 'link' || intent === 'reauth') {
      return full(request, response, next);
    } else {
      next();
    }
  }
}
