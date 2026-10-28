import { routes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { anonymous, type Authorization } from '../shared/authorization';

import { passwordContracts } from './contract';
import type { PasswordController } from './controller';

export function createPasswordRouter(
  controller: PasswordController,
  authenticated: Authorization['authenticated'],
): Router {
  const router = Router();
  const full = authenticated();

  routes.register(
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
      {
        contract: passwordContracts.startReauthentication,
        handler: controller.startReauthentication,
        beforeValidation: [full],
      },
      {
        contract: passwordContracts.completeReauthentication,
        handler: controller.completeReauthentication,
        beforeValidation: [full],
      },
      { contract: passwordContracts.addPassword, handler: controller.addPassword, beforeValidation: [full] },
      { contract: passwordContracts.changePassword, handler: controller.changePassword, beforeValidation: [full] },
      { contract: passwordContracts.removePassword, handler: controller.removePassword, beforeValidation: [full] },
    ],
    controller,
  );

  return router;
}
