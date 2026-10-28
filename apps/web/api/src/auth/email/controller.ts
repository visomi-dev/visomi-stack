import { inject } from '@visomi-stack/backend-shared';
import type { Request, Response } from 'express';

import type { IdentifiedRequest } from '../shared/http';
import { EmailIdentity } from '../email/service';
import { SessionResponses } from '../sessions/response';
import { Flows } from '../shared/flows';
import { SecurityNotifications } from '../shared/notifications';

import type {
  RequestEmailChangeInput,
  RequestVerificationInput,
  ResendChallengeInput,
  VerifyEmailChangeInput,
  VerifyEmailInput,
} from './contract';

export class EmailController {
  private readonly email = inject(EmailIdentity);
  private readonly flows = inject(Flows);
  private readonly notifications = inject(SecurityNotifications);
  private readonly responses = inject(SessionResponses);

  async requestVerification(request: IdentifiedRequest, response: Response, input: RequestVerificationInput) {
    const pending = await this.email.emailStart(
      request.sessionID,
      request.user,
      input.body.email === undefined ? undefined : input.body.email,
    );

    response.status(202).json(pending);
  }

  async verifyEmail(request: IdentifiedRequest, response: Response, input: VerifyEmailInput) {
    const verified = await this.email.emailComplete(
      request.sessionID,
      request.user,
      input.body.flowId,
      input.body.code,
    );

    await this.responses.send(request, response, verified.user);
  }

  async requestEmailChange(request: IdentifiedRequest, response: Response, input: RequestEmailChangeInput) {
    const pending = await this.email.emailStart(request.sessionID, request.user, input.body.email, true);

    response.status(202).json(pending);
  }

  async verifyEmailChange(request: IdentifiedRequest, response: Response, input: VerifyEmailChangeInput) {
    const changed = await this.email.emailComplete(
      request.sessionID,
      request.user,
      input.body.flowId,
      input.body.code,
      true,
    );
    const notificationSent = await this.notifications.notify(changed.previousEmail, 'email_changed');

    await this.responses.send(request, response, changed.user, { notificationSent });
  }

  async resendChallenge(request: Request, response: Response, input: ResendChallengeInput) {
    const pending = await this.flows.resend(request.sessionID, input.body.flowId);

    response.status(202).json(pending);
  }
}
