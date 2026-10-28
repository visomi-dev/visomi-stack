import { registerRoute } from '@visomi-stack/web-backend-shared';
import { Router } from 'express';

import { emailContracts } from './contract';
import type { EmailController } from './controller';

export function createEmailRouter(controller: EmailController): Router {
  const router = Router();

  registerRoute(router, emailContracts.requestVerification, (request, response, input) =>
    controller.requestVerification(request, response, input),
  );
  registerRoute(router, emailContracts.verifyEmail, (request, response, input) =>
    controller.verifyEmail(request, response, input),
  );
  registerRoute(router, emailContracts.requestEmailChange, (request, response, input) =>
    controller.requestEmailChange(request, response, input),
  );
  registerRoute(router, emailContracts.verifyEmailChange, (request, response, input) =>
    controller.verifyEmailChange(request, response, input),
  );
  registerRoute(router, emailContracts.resendChallenge, (request, response, input) =>
    controller.resendChallenge(request, response, input),
  );

  return router;
}
