import { registerRoute } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { sessionsContracts } from './contract';
import type { SessionsController } from './controller';

export function createSessionRouter(controller: SessionsController): Router {
  const router = Router();

  registerRoute(router, sessionsContracts.getSession, (request, response) => controller.getSession(request, response));
  registerRoute(router, sessionsContracts.logout, (request, response) => controller.logout(request, response));
  registerRoute(router, sessionsContracts.listSessions, (request, response) =>
    controller.listSessions(request, response),
  );
  registerRoute(router, sessionsContracts.closeSession, (request, response, input) =>
    controller.closeSession(request, response, input),
  );
  registerRoute(router, sessionsContracts.revokeOtherSessions, (request, response) =>
    controller.revokeOtherSessions(request, response),
  );

  return router;
}
