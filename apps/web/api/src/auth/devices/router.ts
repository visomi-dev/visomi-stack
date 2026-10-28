import { registerRoute } from '@visomi-stack/web-backend-shared';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import { requireAnonymousSession } from '../shared/http';

import { devicesContracts } from './contract';
import type { DevicesController } from './controller';

export function createDeviceRouter(controller: DevicesController): Router {
  const router = Router();

  registerRoute(
    router,
    devicesContracts.requestApproval,
    (request, response, input) => controller.requestApproval(request, response, input),
    anonymousOnly,
  );
  registerRoute(router, devicesContracts.getApprovalStatus, (request, response, input) =>
    controller.getApprovalStatus(request, response, input),
  );
  registerRoute(router, devicesContracts.reviewApproval, (request, response, input) =>
    controller.reviewApproval(request, response, input),
  );
  registerRoute(router, devicesContracts.approve, (request, response, input) =>
    controller.approve(request, response, input),
  );
  registerRoute(router, devicesContracts.deny, (request, response, input) => controller.deny(request, response, input));
  registerRoute(router, devicesContracts.cancelApproval, (request, response, input) =>
    controller.cancelApproval(request, response, input),
  );
  registerRoute(router, devicesContracts.consumeApproval, (request, response, input) =>
    controller.consumeApproval(request, response, input),
  );

  return router;
}

function anonymousOnly(request: Request, _response: Response, next: NextFunction): void {
  requireAnonymousSession(request);
  next();
}
