import { inject } from '@visomi-stack/backend-shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import { EmailIdentity } from '../email/service';
import { SessionResponses } from '../sessions/response';
import { Flows } from '../shared/flows';
import { requirePrincipal } from '../shared/http';
import { SecurityNotifications } from '../shared/notifications';

import { emailContracts } from './contract';

export class EmailController {
  private readonly email = inject(EmailIdentity);
  private readonly flows = inject(Flows);
  private readonly notifications = inject(SecurityNotifications);
  private readonly responses = inject(SessionResponses);

  async requestVerification(
    request: Request,
    response: Response,
    input: z.output<typeof emailContracts.requestVerification.request>,
  ) {
    const pending = await this.email.emailStart(
      request.sessionID,
      requirePrincipal(request),
      input.body.email === undefined ? undefined : input.body.email,
    );

    response.status(202).json(pending);
  }

  async verifyEmail(request: Request, response: Response, input: z.output<typeof emailContracts.verifyEmail.request>) {
    const verified = await this.email.emailComplete(
      request.sessionID,
      requirePrincipal(request),
      input.body.flowId,
      input.body.code,
    );

    await this.responses.send(request, response, verified.user);
  }

  async requestEmailChange(
    request: Request,
    response: Response,
    input: z.output<typeof emailContracts.requestEmailChange.request>,
  ) {
    const pending = await this.email.emailStart(request.sessionID, requirePrincipal(request), input.body.email, true);

    response.status(202).json(pending);
  }

  async verifyEmailChange(
    request: Request,
    response: Response,
    input: z.output<typeof emailContracts.verifyEmailChange.request>,
  ) {
    const changed = await this.email.emailComplete(
      request.sessionID,
      requirePrincipal(request),
      input.body.flowId,
      input.body.code,
      true,
    );
    const notificationSent = await this.notifications.notify(changed.previousEmail, 'email_changed');

    await this.responses.send(request, response, changed.user, { notificationSent });
  }

  async resendChallenge(
    request: Request,
    response: Response,
    input: z.output<typeof emailContracts.resendChallenge.request>,
  ) {
    const pending = await this.flows.resend(request.sessionID, input.body.flowId);

    response.status(202).json(pending);
  }
}
