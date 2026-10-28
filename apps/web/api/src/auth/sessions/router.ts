import { registerRoutes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { sessionsContracts } from './contract';
import type { SessionsController } from './controller';

export function createSessionRouter(controller: SessionsController): Router {
  const router = Router();

  registerRoutes(
    router,
    [
      { contract: sessionsContracts.getSession, handler: controller.getSession },
      { contract: sessionsContracts.logout, handler: controller.logout },
      { contract: sessionsContracts.listSessions, handler: controller.listSessions },
      { contract: sessionsContracts.closeSession, handler: controller.closeSession },
      { contract: sessionsContracts.revokeOtherSessions, handler: controller.revokeOtherSessions },
    ],
    controller,
  );

  return router;
}
