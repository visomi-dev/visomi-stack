import { routes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { type Authorization } from '../shared/authorization';

import { methodsContracts } from './contract';
import type { MethodsController } from './controller';

export function createMethodRouter(
  controller: MethodsController,
  authenticated: Authorization['authenticated'],
): Router {
  const router = Router();
  const full = authenticated();

  routes.register(
    router,
    [
      { contract: methodsContracts.getProviders, handler: controller.getProviders },
      { contract: methodsContracts.getMethods, handler: controller.getMethods, beforeValidation: [full] },
    ],
    controller,
  );

  return router;
}
