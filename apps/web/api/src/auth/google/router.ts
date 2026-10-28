import { registerRoutes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { googleContracts } from './contract';
import type { GoogleController } from './controller';

export function createGoogleRouter(controller: GoogleController): Router {
  const router = Router();

  registerRoutes(
    router,
    [
      { contract: googleContracts.startGoogle, handler: controller.startGoogle },
      { contract: googleContracts.completeGoogle, handler: controller.completeGoogle },
      { contract: googleContracts.verifyGoogleEmail, handler: controller.verifyGoogleEmail },
      { contract: googleContracts.unlinkGoogle, handler: controller.unlinkGoogle },
    ],
    controller,
  );

  return router;
}
