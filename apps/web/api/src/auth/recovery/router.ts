import { registerRoutes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { recoveryContracts } from './contract';
import type { RecoveryController } from './controller';

export function createRecoveryRouter(controller: RecoveryController): Router {
  const router = Router();

  registerRoutes(router, [
    { contract: recoveryContracts.requestRecovery, handler: controller.requestRecovery.bind(controller) },
    { contract: recoveryContracts.verifyRecovery, handler: controller.verifyRecovery.bind(controller) },
    { contract: recoveryContracts.requestReset, handler: controller.requestReset.bind(controller) },
    { contract: recoveryContracts.completeReset, handler: controller.completeReset.bind(controller) },
    { contract: recoveryContracts.stagePassword, handler: controller.stagePassword.bind(controller) },
    { contract: recoveryContracts.completePassword, handler: controller.completePassword.bind(controller) },
  ]);

  return router;
}
