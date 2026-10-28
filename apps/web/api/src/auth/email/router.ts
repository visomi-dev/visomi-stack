import { registerRoutes } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { emailContracts } from './contract';
import type { EmailController } from './controller';

export function createEmailRouter(controller: EmailController): Router {
  const router = Router();

  registerRoutes(router, [
    { contract: emailContracts.requestVerification, handler: controller.requestVerification.bind(controller) },
    { contract: emailContracts.verifyEmail, handler: controller.verifyEmail.bind(controller) },
    { contract: emailContracts.requestEmailChange, handler: controller.requestEmailChange.bind(controller) },
    { contract: emailContracts.verifyEmailChange, handler: controller.verifyEmailChange.bind(controller) },
    { contract: emailContracts.resendChallenge, handler: controller.resendChallenge.bind(controller) },
  ]);

  return router;
}
