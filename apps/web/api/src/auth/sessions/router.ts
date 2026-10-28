import { registerRoutes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { sessionsContracts } from './contract';
import type { SessionsController } from './controller';

export function createSessionRouter(controller: SessionsController): Router {
  const router = Router();

  registerRoutes(router, [
    { contract: sessionsContracts.getSession, handler: controller.getSession.bind(controller) },
    { contract: sessionsContracts.logout, handler: controller.logout.bind(controller) },
    { contract: sessionsContracts.listSessions, handler: controller.listSessions.bind(controller) },
    { contract: sessionsContracts.closeSession, handler: controller.closeSession.bind(controller) },
    { contract: sessionsContracts.revokeOtherSessions, handler: controller.revokeOtherSessions.bind(controller) },
  ]);

  return router;
}
