import { routes } from '@visomi-stack/web-backend-shared';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import type { Authorization } from '../shared/authorization';
import { requireFull } from '../shared/identity';

import { passkeysContracts } from './contract';
import type { PasskeysController } from './controller';

export function createPasskeyRouter(
  controller: PasskeysController,
  authenticated: Authorization['authenticated'],
): Router {
  const router = Router();

  routes.register(
    router,
    [
      {
        contract: passkeysContracts.registrationOptions,
        handler: controller.registrationOptions,
        beforeValidation: [enrollmentOnly],
      },
      {
        contract: passkeysContracts.registerPasskey,
        handler: controller.registerPasskey,
        beforeValidation: [enrollmentOnly],
      },
      { contract: passkeysContracts.authenticationOptions, handler: controller.authenticationOptions },
      { contract: passkeysContracts.authenticatePasskey, handler: controller.authenticatePasskey },
    ],
    controller,
  );
  router.use('/passkeys', authenticated());
  routes.register(
    router,
    [
      { contract: passkeysContracts.listPasskeys, handler: controller.listPasskeys },
      { contract: passkeysContracts.renamePasskey, handler: controller.renamePasskey },
      { contract: passkeysContracts.revokePasskey, handler: controller.revokePasskey },
    ],
    controller,
  );

  return router;
}

function enrollmentOnly(request: Request, _response: Response, next: NextFunction): void {
  if (request.user && !request.user.grantId) {
    requireFull(request.user);
  }

  next();
}
