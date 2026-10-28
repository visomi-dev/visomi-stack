import { registerRoutes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { methodsContracts } from './contract';
import type { MethodsController } from './controller';

export function createMethodRouter(controller: MethodsController): Router {
  const router = Router();

  registerRoutes(router, [
    { contract: methodsContracts.getProviders, handler: controller.getProviders.bind(controller) },
    { contract: methodsContracts.getMethods, handler: controller.getMethods.bind(controller) },
  ]);

  return router;
}
