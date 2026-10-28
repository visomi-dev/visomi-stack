import { registerRoutes } from '@visomi-stack/web-backend-shared';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import { requireFull } from '../shared/identity';

import { passkeysContracts } from './contract';
import type { PasskeysController } from './controller';

export function createPasskeyRouter(controller: PasskeysController): Router {
  const router = Router();

  registerRoutes(router, [
    { contract: passkeysContracts.registrationOptions, handler: controller.registrationOptions.bind(controller) },
    {
      contract: passkeysContracts.registerPasskey,
      handler: controller.registerPasskey.bind(controller),
      beforeValidation: [enrollmentOnly],
    },
    { contract: passkeysContracts.authenticationOptions, handler: controller.authenticationOptions.bind(controller) },
    { contract: passkeysContracts.authenticatePasskey, handler: controller.authenticatePasskey.bind(controller) },
  ]);
  router.use('/passkeys', verifiedOnly);
  registerRoutes(router, [
    { contract: passkeysContracts.listPasskeys, handler: controller.listPasskeys.bind(controller) },
    { contract: passkeysContracts.renamePasskey, handler: controller.renamePasskey.bind(controller) },
    { contract: passkeysContracts.revokePasskey, handler: controller.revokePasskey.bind(controller) },
  ]);

  return router;
}

function verifiedOnly(request: Request, _response: Response, next: NextFunction): void {
  requireFull(request.user);
  next();
}

function enrollmentOnly(request: Request, _response: Response, next: NextFunction): void {
  if (request.user && !request.user.grantId) {
    requireFull(request.user);
  }

  next();
}
