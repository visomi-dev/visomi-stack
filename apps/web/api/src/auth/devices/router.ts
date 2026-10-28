import { registerRoutes } from '@visomi-stack/web-backend-shared';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import { requireAnonymousSession } from '../shared/http';

import { devicesContracts } from './contract';
import type { DevicesController } from './controller';

export function createDeviceRouter(controller: DevicesController): Router {
  const router = Router();

  registerRoutes(router, [
    {
      contract: devicesContracts.requestApproval,
      handler: controller.requestApproval.bind(controller),
      beforeValidation: [anonymousOnly],
    },
    { contract: devicesContracts.getApprovalStatus, handler: controller.getApprovalStatus.bind(controller) },
    { contract: devicesContracts.reviewApproval, handler: controller.reviewApproval.bind(controller) },
    { contract: devicesContracts.approve, handler: controller.approve.bind(controller) },
    { contract: devicesContracts.deny, handler: controller.deny.bind(controller) },
    { contract: devicesContracts.cancelApproval, handler: controller.cancelApproval.bind(controller) },
    { contract: devicesContracts.consumeApproval, handler: controller.consumeApproval.bind(controller) },
  ]);

  return router;
}

function anonymousOnly(request: Request, _response: Response, next: NextFunction): void {
  requireAnonymousSession(request);
  next();
}
