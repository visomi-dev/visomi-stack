import { registerRoute } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { googleContracts } from './contract';
import type { GoogleController } from './controller';

export function createGoogleRouter(controller: GoogleController): Router {
  const router = Router();

  registerRoute(router, googleContracts.startGoogle, (request, response, input) =>
    controller.startGoogle(request, response, input),
  );
  registerRoute(router, googleContracts.completeGoogle, (request, response, input) =>
    controller.completeGoogle(request, response, input),
  );
  registerRoute(router, googleContracts.verifyGoogleEmail, (request, response, input) =>
    controller.verifyGoogleEmail(request, response, input),
  );
  registerRoute(router, googleContracts.unlinkGoogle, (request, response, input) =>
    controller.unlinkGoogle(request, response, input),
  );

  return router;
}
