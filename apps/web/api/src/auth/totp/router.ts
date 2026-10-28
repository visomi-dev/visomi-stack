import { registerRoutes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { totpContracts } from './contract';
import type { TotpController } from './controller';

export function createTotpRouter(controller: TotpController): Router {
  const router = Router();

  registerRoutes(router, [
    { contract: totpContracts.setupTotp, handler: controller.setupTotp.bind(controller) },
    { contract: totpContracts.confirmTotp, handler: controller.confirmTotp.bind(controller) },
    { contract: totpContracts.removeTotp, handler: controller.removeTotp.bind(controller) },
    { contract: totpContracts.regenerateRecoveryCodes, handler: controller.regenerateRecoveryCodes.bind(controller) },
  ]);

  return router;
}
