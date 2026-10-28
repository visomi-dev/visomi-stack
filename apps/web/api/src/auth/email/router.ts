import { registerRoutes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { emailContracts } from './contract';
import type { EmailController } from './controller';

export function createEmailRouter(controller: EmailController): Router {
  const router = Router();

  registerRoutes(
    router,
    [
      { contract: emailContracts.requestVerification, handler: controller.requestVerification },
      { contract: emailContracts.verifyEmail, handler: controller.verifyEmail },
      { contract: emailContracts.requestEmailChange, handler: controller.requestEmailChange },
      { contract: emailContracts.verifyEmailChange, handler: controller.verifyEmailChange },
      { contract: emailContracts.resendChallenge, handler: controller.resendChallenge },
    ],
    controller,
  );

  return router;
}
