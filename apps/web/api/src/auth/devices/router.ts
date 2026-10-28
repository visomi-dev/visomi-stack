import { routes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { anonymous, type Authorization } from '../shared/authorization';

import { devicesContracts } from './contract';
import type { DevicesController } from './controller';

export function createDeviceRouter(
  controller: DevicesController,
  authenticated: Authorization['authenticated'],
): Router {
  const router = Router();
  const full = authenticated();

  routes.register(
    router,
    [
      {
        contract: devicesContracts.requestApproval,
        handler: controller.requestApproval,
        beforeValidation: [anonymous],
      },
      { contract: devicesContracts.getApprovalStatus, handler: controller.getApprovalStatus },
      { contract: devicesContracts.reviewApproval, handler: controller.reviewApproval, beforeValidation: [full] },
      { contract: devicesContracts.approve, handler: controller.approve, beforeValidation: [full] },
      { contract: devicesContracts.deny, handler: controller.deny, beforeValidation: [full] },
      { contract: devicesContracts.cancelApproval, handler: controller.cancelApproval },
      { contract: devicesContracts.consumeApproval, handler: controller.consumeApproval },
    ],
    controller,
  );

  return router;
}
