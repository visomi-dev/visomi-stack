import { inject } from '@visomi-stack/backend-shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import { Recovery } from '../recovery/service';
import { SessionResponses } from '../sessions/response';
import { requirePrincipal } from '../shared/http';
import { SecurityNotifications } from '../shared/notifications';

import { recoveryContracts } from './contract';

export class RecoveryController {
  private readonly recovery = inject(Recovery);
  private readonly notifications = inject(SecurityNotifications);
  private readonly responses = inject(SessionResponses);

  async stagePassword(
    request: Request,
    response: Response,
    input: z.output<typeof recoveryContracts.stagePassword.request>,
  ) {
    const pending = await this.recovery.password(request.sessionID, requirePrincipal(request), input.body.password);

    response.status(202).json(pending);
  }

  async completePassword(
    request: Request,
    response: Response,
    input: z.output<typeof recoveryContracts.completePassword.request>,
  ) {
    const user = await this.recovery.passwordComplete(
      request.sessionID,
      requirePrincipal(request),
      input.body.flowId,
      input.body.password,
      input.body.factor,
    );
    const notificationSent = await this.notifications.notify(user.email, 'password_recovered');

    await this.responses.send(request, response, user, { notificationSent });
  }

  async requestRecovery(
    request: Request,
    response: Response,
    input: z.output<typeof recoveryContracts.requestRecovery.request>,
  ) {
    const pending = await this.recovery.request(request.sessionID, input.body.email, false, request.user);

    response.status(202).json(pending);
  }

  async requestReset(
    request: Request,
    response: Response,
    input: z.output<typeof recoveryContracts.requestReset.request>,
  ) {
    const pending = await this.recovery.request(request.sessionID, input.body.email, true, request.user);

    response.status(202).json(pending);
  }

  async verifyRecovery(
    request: Request,
    response: Response,
    input: z.output<typeof recoveryContracts.verifyRecovery.request>,
  ) {
    const recovered = await this.recovery.verify(
      request.sessionID,
      input.body.flowId,
      input.body.code,
      input.body.factor,
      undefined,
      request.user,
    );
    const user = recovered.user;
    const notificationSent = await this.notifications.notify(recovered.email, 'recovery_authorized');

    await this.responses.send(request, response, user, { notificationSent });
  }

  async completeReset(
    request: Request,
    response: Response,
    input: z.output<typeof recoveryContracts.completeReset.request>,
  ) {
    const recovered = await this.recovery.verify(
      request.sessionID,
      input.body.flowId,
      input.body.code,
      input.body.factor,
      input.body.password,
      request.user,
    );
    const user = recovered.user;
    const notificationSent = await this.notifications.notify(recovered.email, 'password_reset');

    if (!request.user) {
      response.json({ passwordReset: true, notificationSent });
    } else {
      await this.responses.send(request, response, user, { notificationSent });
    }
  }
}
