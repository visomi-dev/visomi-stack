import { registerRoute } from '@visomi-stack/web-backend-shared';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import { requireFull } from '../shared/identity';

import { passkeysContracts } from './contract';
import type { PasskeysController } from './controller';

export function createPasskeyRouter(controller: PasskeysController): Router {
  const router = Router();

  registerRoute(router, passkeysContracts.registrationOptions, (request, response, input) =>
    controller.registrationOptions(request, response, input),
  );
  registerRoute(
    router,
    passkeysContracts.registerPasskey,
    (request, response, input) => controller.registerPasskey(request, response, input),
    enrollmentOnly,
  );
  registerRoute(router, passkeysContracts.authenticationOptions, (request, response) =>
    controller.authenticationOptions(request, response),
  );
  registerRoute(router, passkeysContracts.authenticatePasskey, (request, response, input) =>
    controller.authenticatePasskey(request, response, input),
  );
  router.use('/passkeys', verifiedOnly);
  registerRoute(router, passkeysContracts.listPasskeys, (request, response) =>
    controller.listPasskeys(request, response),
  );
  registerRoute(router, passkeysContracts.renamePasskey, (request, response, input) =>
    controller.renamePasskey(request, response, input),
  );
  registerRoute(router, passkeysContracts.revokePasskey, (request, response, input) =>
    controller.revokePasskey(request, response, input),
  );

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
