import { registerRoutes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { methodsContracts } from './contract';
import type { MethodsController } from './controller';

export function createMethodRouter(controller: MethodsController): Router {
  const router = Router();

  registerRoutes(
    router,
    [
      { contract: methodsContracts.getProviders, handler: controller.getProviders },
      { contract: methodsContracts.getMethods, handler: controller.getMethods },
    ],
    controller,
  );

  return router;
}
