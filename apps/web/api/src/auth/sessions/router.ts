import { routes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { type Authorization } from '../shared/authorization';

import { sessionsContracts } from './contract';
import type { SessionsController } from './controller';

export function createSessionRouter(
  controller: SessionsController,
  authenticated: Authorization['authenticated'],
): Router {
  const router = Router();
  const full = authenticated();

  routes.register(
    router,
    [
      { contract: sessionsContracts.getSession, handler: controller.getSession },
      { contract: sessionsContracts.logout, handler: controller.logout },
      { contract: sessionsContracts.listSessions, handler: controller.listSessions, beforeValidation: [full] },
      { contract: sessionsContracts.closeSession, handler: controller.closeSession, beforeValidation: [full] },
      {
        contract: sessionsContracts.revokeOtherSessions,
        handler: controller.revokeOtherSessions,
        beforeValidation: [full],
      },
    ],
    controller,
  );

  return router;
}
