import { inject } from '@visomi-stack/backend-shared';
import type { Request, Response } from 'express';

import type { IdentifiedRequest } from '../shared/http';
import { EmailIdentity } from '../email/service';
import { Passwords } from '../password/service';
import { SessionResponses } from '../sessions/response';
import { sessionView } from '../shared/http';
import { SecurityNotifications } from '../shared/notifications';

import type {
  AddPasswordInput,
  ChangePasswordInput,
  CompleteReauthenticationInput,
  RemovePasswordInput,
  SignInInput,
  SignUpInput,
  StartReauthenticationInput,
  VerifySignInInput,
} from './contract';

export class PasswordController {
  private readonly password = inject(Passwords);
  private readonly email = inject(EmailIdentity);
  private readonly notifications = inject(SecurityNotifications);
  private readonly responses = inject(SessionResponses);

  async signUp(request: Request, response: Response, input: SignUpInput) {
    const user = await this.password.signup(request.sessionID, input.body.email, input.body.password);

    await this.responses.establish(request, user);

    const verification = await this.email.emailStart(request.sessionID, user);

    response.status(201).json({ ...sessionView(request), ...verification });
  }

  async signIn(request: Request, response: Response, input: SignInInput) {
    const pending = await this.password.signIn(request.sessionID, input.body.email, input.body.password);

    response.status(202).json(pending);
  }

  async verifySignIn(request: Request, response: Response, input: VerifySignInInput) {
    const user = await this.password.loginComplete(request.sessionID, input.body.flowId, input.body.factor);

    await this.responses.send(request, response, user);
  }

  async startReauthentication(request: IdentifiedRequest, response: Response, input: StartReauthenticationInput) {
    const pending = await this.password.reauthStart(request.sessionID, request.user, input.body.password);

    response.status(202).json(pending);
  }

  async completeReauthentication(request: IdentifiedRequest, response: Response, input: CompleteReauthenticationInput) {
    const user = await this.password.reauthComplete(
      request.sessionID,
      request.user,
      input.body.flowId,
      input.body.factor,
    );

    await this.responses.send(request, response, user);
  }

  async addPassword(request: IdentifiedRequest, response: Response, input: AddPasswordInput) {
    const user = request.user;
    const updated = await this.password.passwordChange(request.sessionID, user, input.body.password, true);
    const notificationSent = await this.notifications.notify(user.email, 'password_changed');

    await this.responses.send(request, response, updated, { notificationSent });
  }

  async changePassword(request: IdentifiedRequest, response: Response, input: ChangePasswordInput) {
    const user = request.user;
    const updated = await this.password.passwordChange(request.sessionID, user, input.body.password, false);
    const notificationSent = await this.notifications.notify(user.email, 'password_changed');

    await this.responses.send(request, response, updated, { notificationSent });
  }

  async removePassword(request: IdentifiedRequest, response: Response, _input: RemovePasswordInput) {
    const user = request.user;
    const updated = await this.password.passwordChange(request.sessionID, user, null, false);
    const notificationSent = await this.notifications.notify(user.email, 'password_changed');

    await this.responses.send(request, response, updated, { notificationSent });
  }
}
