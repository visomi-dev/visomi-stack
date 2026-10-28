import { inject } from '@visomi-stack/backend-shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import { EmailIdentity } from '../email/service';
import { Passwords } from '../password/service';
import { SessionResponses } from '../sessions/response';
import { requireAnonymousSession, requirePrincipal, sessionView } from '../shared/http';
import { SecurityNotifications } from '../shared/notifications';

import { passwordContracts } from './contract';

export class PasswordController {
  private readonly password = inject(Passwords);
  private readonly email = inject(EmailIdentity);
  private readonly notifications = inject(SecurityNotifications);
  private readonly responses = inject(SessionResponses);

  async signUp(request: Request, response: Response, input: z.output<typeof passwordContracts.signUp.request>) {
    requireAnonymousSession(request);

    const user = await this.password.signup(request.sessionID, input.body.email, input.body.password);

    await this.responses.establish(request, user);
    const verification = await this.email.emailStart(request.sessionID, user);

    response.status(201).json({ ...sessionView(request), ...verification });
  }

  async signIn(request: Request, response: Response, input: z.output<typeof passwordContracts.signIn.request>) {
    requireAnonymousSession(request);

    const pending = await this.password.signIn(request.sessionID, input.body.email, input.body.password);

    response.status(202).json(pending);
  }

  async verifySignIn(
    request: Request,
    response: Response,
    input: z.output<typeof passwordContracts.verifySignIn.request>,
  ) {
    requireAnonymousSession(request);

    const user = await this.password.loginComplete(request.sessionID, input.body.flowId, input.body.factor);

    await this.responses.send(request, response, user);
  }

  async startReauthentication(
    request: Request,
    response: Response,
    input: z.output<typeof passwordContracts.startReauthentication.request>,
  ) {
    const pending = await this.password.reauthStart(request.sessionID, requirePrincipal(request), input.body.password);

    response.status(202).json(pending);
  }

  async completeReauthentication(
    request: Request,
    response: Response,
    input: z.output<typeof passwordContracts.completeReauthentication.request>,
  ) {
    const user = await this.password.reauthComplete(
      request.sessionID,
      requirePrincipal(request),
      input.body.flowId,
      input.body.factor,
    );

    await this.responses.send(request, response, user);
  }

  async addPassword(
    request: Request,
    response: Response,
    input: z.output<typeof passwordContracts.addPassword.request>,
  ) {
    const user = requirePrincipal(request);
    const updated = await this.password.passwordChange(request.sessionID, user, input.body.password, true);
    const notificationSent = await this.notifications.notify(user.email, 'password_changed');

    await this.responses.send(request, response, updated, { notificationSent });
  }

  async changePassword(
    request: Request,
    response: Response,
    input: z.output<typeof passwordContracts.changePassword.request>,
  ) {
    const user = requirePrincipal(request);
    const updated = await this.password.passwordChange(request.sessionID, user, input.body.password, false);
    const notificationSent = await this.notifications.notify(user.email, 'password_changed');

    await this.responses.send(request, response, updated, { notificationSent });
  }

  async removePassword(
    request: Request,
    response: Response,
    _input: z.output<typeof passwordContracts.removePassword.request>,
  ) {
    const user = requirePrincipal(request);
    const updated = await this.password.passwordChange(request.sessionID, user, null, false);
    const notificationSent = await this.notifications.notify(user.email, 'password_changed');

    await this.responses.send(request, response, updated, { notificationSent });
  }
}
