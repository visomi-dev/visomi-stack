import { registerRoutes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { anonymous } from '../shared/authorization';

import { devicesContracts } from './contract';
import type { DevicesController } from './controller';

export function createDeviceRouter(controller: DevicesController): Router {
  const router = Router();

  registerRoutes(
    router,
    [
      {
        contract: devicesContracts.requestApproval,
        handler: controller.requestApproval,
        beforeValidation: [anonymous],
      },
      { contract: devicesContracts.getApprovalStatus, handler: controller.getApprovalStatus },
      { contract: devicesContracts.reviewApproval, handler: controller.reviewApproval },
      { contract: devicesContracts.approve, handler: controller.approve },
      { contract: devicesContracts.deny, handler: controller.deny },
      { contract: devicesContracts.cancelApproval, handler: controller.cancelApproval },
      { contract: devicesContracts.consumeApproval, handler: controller.consumeApproval },
    ],
    controller,
  );

  return router;
}
