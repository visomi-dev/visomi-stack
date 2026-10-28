import { inject } from '@visomi-stack/backend-shared';
import type { Response } from 'express';

import type { IdentifiedRequest } from '../shared/http';
import { SessionResponses } from '../sessions/response';
import { Flows } from '../shared/flows';
import { SecurityNotifications } from '../shared/notifications';
import { Factors } from '../totp/service';

import type { ConfirmTotpInput } from './contract';

export class TotpController {
  private readonly factors = inject(Factors);
  private readonly flows = inject(Flows);
  private readonly notifications = inject(SecurityNotifications);
  private readonly responses = inject(SessionResponses);

  async setupTotp(request: IdentifiedRequest, response: Response) {
    const setup = await this.factors.setup(request.sessionID, request.user);

    response.status(201).json(setup);
  }

  async confirmTotp(request: IdentifiedRequest, response: Response, input: ConfirmTotpInput) {
    const user = request.user;
    const id = input.body.enrollmentId;

    await this.flows.limit('totp-confirm', id, 5);
    const confirmed = await this.factors.confirm(request.sessionID, user, id, input.body.code);
    const notificationSent = await this.notifications.notify(user.email, 'totp_enabled');

    await this.responses.send(request, response, confirmed.user, {
      recoveryCodes: confirmed.codes,
      notificationSent,
    });
  }

  async removeTotp(request: IdentifiedRequest, response: Response) {
    const user = request.user;
    const updated = await this.factors.remove(request.sessionID, user);
    const notificationSent = await this.notifications.notify(user.email, 'totp_disabled');

    await this.responses.send(request, response, updated, { notificationSent });
  }

  async regenerateRecoveryCodes(request: IdentifiedRequest, response: Response) {
    const updated = await this.factors.regenerate(request.sessionID, request.user);

    await this.responses.send(request, response, updated.user, { recoveryCodes: updated.codes });
  }
}
