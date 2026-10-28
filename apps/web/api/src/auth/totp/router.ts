import { routes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { type Authorization } from '../shared/authorization';

import { totpContracts } from './contract';
import type { TotpController } from './controller';

export function createTotpRouter(controller: TotpController, authenticated: Authorization['authenticated']): Router {
  const router = Router();
  const full = authenticated();

  routes.register(
    router,
    [
      { contract: totpContracts.setupTotp, handler: controller.setupTotp, beforeValidation: [full] },
      { contract: totpContracts.confirmTotp, handler: controller.confirmTotp, beforeValidation: [full] },
      { contract: totpContracts.removeTotp, handler: controller.removeTotp, beforeValidation: [full] },
      {
        contract: totpContracts.regenerateRecoveryCodes,
        handler: controller.regenerateRecoveryCodes,
        beforeValidation: [full],
      },
    ],
    controller,
  );

  return router;
}
