import { registerRoutes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { googleContracts } from './contract';
import type { GoogleController } from './controller';

export function createGoogleRouter(controller: GoogleController): Router {
  const router = Router();

  registerRoutes(router, [
    { contract: googleContracts.startGoogle, handler: controller.startGoogle.bind(controller) },
    { contract: googleContracts.completeGoogle, handler: controller.completeGoogle.bind(controller) },
    { contract: googleContracts.verifyGoogleEmail, handler: controller.verifyGoogleEmail.bind(controller) },
    { contract: googleContracts.unlinkGoogle, handler: controller.unlinkGoogle.bind(controller) },
  ]);

  return router;
}
