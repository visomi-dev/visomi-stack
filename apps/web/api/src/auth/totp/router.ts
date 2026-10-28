import { registerRoute } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { totpContracts } from './contract';
import type { TotpController } from './controller';

export function createTotpRouter(controller: TotpController): Router {
  const router = Router();

  registerRoute(router, totpContracts.setupTotp, (request, response) => controller.setupTotp(request, response));
  registerRoute(router, totpContracts.confirmTotp, (request, response, input) =>
    controller.confirmTotp(request, response, input),
  );
  registerRoute(router, totpContracts.removeTotp, (request, response) => controller.removeTotp(request, response));
  registerRoute(router, totpContracts.regenerateRecoveryCodes, (request, response) =>
    controller.regenerateRecoveryCodes(request, response),
  );

  return router;
}
