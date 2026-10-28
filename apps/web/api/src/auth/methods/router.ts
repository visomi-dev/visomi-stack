import { registerRoute } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { methodsContracts } from './contract';
import type { MethodsController } from './controller';

export function createMethodRouter(controller: MethodsController): Router {
  const router = Router();

  registerRoute(router, methodsContracts.getProviders, (request, response) =>
    controller.getProviders(request, response),
  );
  registerRoute(router, methodsContracts.getMethods, (request, response) => controller.getMethods(request, response));

  return router;
}
