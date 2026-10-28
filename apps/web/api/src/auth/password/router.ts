import { registerRoutes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { anonymous } from '../shared/authorization';

import { passwordContracts } from './contract';
import type { PasswordController } from './controller';

export function createPasswordRouter(controller: PasswordController): Router {
  const router = Router();

  registerRoutes(
    router,
    [
      {
        contract: passwordContracts.signUp,
        handler: controller.signUp,
        beforeValidation: [anonymous],
      },
      {
        contract: passwordContracts.signIn,
        handler: controller.signIn,
        beforeValidation: [anonymous],
      },
      {
        contract: passwordContracts.verifySignIn,
        handler: controller.verifySignIn,
        beforeValidation: [anonymous],
      },
      { contract: passwordContracts.startReauthentication, handler: controller.startReauthentication },
      {
        contract: passwordContracts.completeReauthentication,
        handler: controller.completeReauthentication,
      },
      { contract: passwordContracts.addPassword, handler: controller.addPassword },
      { contract: passwordContracts.changePassword, handler: controller.changePassword },
      { contract: passwordContracts.removePassword, handler: controller.removePassword },
    ],
    controller,
  );

  return router;
}
