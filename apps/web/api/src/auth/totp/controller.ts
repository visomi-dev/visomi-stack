import { inject } from '@visomi-stack/backend-shared';
import type { Request, Response } from 'express';

import { SessionResponses } from '../sessions/response';
import { Flows } from '../shared/flows';
import { requirePrincipal } from '../shared/http';
import { SecurityNotifications } from '../shared/notifications';
import { Factors } from '../totp/service';

import type { ConfirmTotpInput } from './contract';

export class TotpController {
  private readonly factors = inject(Factors);
  private readonly flows = inject(Flows);
  private readonly notifications = inject(SecurityNotifications);
  private readonly responses = inject(SessionResponses);

  async setupTotp(request: Request, response: Response) {
    const setup = await this.factors.setup(request.sessionID, requirePrincipal(request));

    response.status(201).json(setup);
  }

  async confirmTotp(request: Request, response: Response, input: ConfirmTotpInput) {
    const user = requirePrincipal(request);
    const id = input.body.enrollmentId;

    await this.flows.limit('totp-confirm', id, 5);
    const confirmed = await this.factors.confirm(request.sessionID, user, id, input.body.code);
    const notificationSent = await this.notifications.notify(user.email, 'totp_enabled');

    await this.responses.send(request, response, confirmed.user, {
      recoveryCodes: confirmed.codes,
      notificationSent,
    });
  }

  async removeTotp(request: Request, response: Response) {
    const user = requirePrincipal(request);
    const updated = await this.factors.remove(request.sessionID, user);
    const notificationSent = await this.notifications.notify(user.email, 'totp_disabled');

    await this.responses.send(request, response, updated, { notificationSent });
  }

  async regenerateRecoveryCodes(request: Request, response: Response) {
    const updated = await this.factors.regenerate(request.sessionID, requirePrincipal(request));

    await this.responses.send(request, response, updated.user, { recoveryCodes: updated.codes });
  }
}
