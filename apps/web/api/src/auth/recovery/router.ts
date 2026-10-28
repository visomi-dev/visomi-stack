import { registerRoute } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { recoveryContracts } from './contract';
import type { RecoveryController } from './controller';

export function createRecoveryRouter(controller: RecoveryController): Router {
  const router = Router();

  registerRoute(router, recoveryContracts.requestRecovery, (request, response, input) =>
    controller.requestRecovery(request, response, input),
  );
  registerRoute(router, recoveryContracts.verifyRecovery, (request, response, input) =>
    controller.verifyRecovery(request, response, input),
  );
  registerRoute(router, recoveryContracts.requestReset, (request, response, input) =>
    controller.requestReset(request, response, input),
  );
  registerRoute(router, recoveryContracts.completeReset, (request, response, input) =>
    controller.completeReset(request, response, input),
  );
  registerRoute(router, recoveryContracts.stagePassword, (request, response, input) =>
    controller.stagePassword(request, response, input),
  );
  registerRoute(router, recoveryContracts.completePassword, (request, response, input) =>
    controller.completePassword(request, response, input),
  );

  return router;
}
