import { registerRoutes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { recoveryContracts } from './contract';
import type { RecoveryController } from './controller';

export function createRecoveryRouter(controller: RecoveryController): Router {
  const router = Router();

  registerRoutes(
    router,
    [
      { contract: recoveryContracts.requestRecovery, handler: controller.requestRecovery },
      { contract: recoveryContracts.verifyRecovery, handler: controller.verifyRecovery },
      { contract: recoveryContracts.requestReset, handler: controller.requestReset },
      { contract: recoveryContracts.completeReset, handler: controller.completeReset },
      { contract: recoveryContracts.stagePassword, handler: controller.stagePassword },
      { contract: recoveryContracts.completePassword, handler: controller.completePassword },
    ],
    controller,
  );

  return router;
}
