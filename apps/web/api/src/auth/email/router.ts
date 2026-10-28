import { routes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { type Authorization, identified } from '../shared/authorization';

import { emailContracts } from './contract';
import type { EmailController } from './controller';

export function createEmailRouter(controller: EmailController, authenticated: Authorization['authenticated']): Router {
  const router = Router();
  const full = authenticated();

  routes.register(
    router,
    [
      {
        contract: emailContracts.requestVerification,
        handler: controller.requestVerification,
        beforeValidation: [identified],
      },
      { contract: emailContracts.verifyEmail, handler: controller.verifyEmail, beforeValidation: [identified] },
      { contract: emailContracts.requestEmailChange, handler: controller.requestEmailChange, beforeValidation: [full] },
      { contract: emailContracts.verifyEmailChange, handler: controller.verifyEmailChange, beforeValidation: [full] },
      { contract: emailContracts.resendChallenge, handler: controller.resendChallenge },
    ],
    controller,
  );

  return router;
}
