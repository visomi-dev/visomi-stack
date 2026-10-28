import { inject } from '@visomi-stack/backend-shared';
import type { Request, Response } from 'express';

import type { IdentifiedRequest } from '../shared/http';
import { Google } from '../google/service';
import { SessionResponses } from '../sessions/response';
import { SecurityNotifications } from '../shared/notifications';

import type { CompleteGoogleInput, StartGoogleInput, UnlinkGoogleInput, VerifyGoogleEmailInput } from './contract';

export class GoogleController {
  private readonly google = inject(Google);
  private readonly notifications = inject(SecurityNotifications);
  private readonly responses = inject(SessionResponses);

  async startGoogle(request: Request, response: Response, input: StartGoogleInput) {
    const intent = input.body.intent;

    const pending = await this.google.start(request.sessionID, intent, request.user);

    response.status(201).json(pending);
  }

  async completeGoogle(request: Request, response: Response, input: CompleteGoogleInput) {
    const completed = await this.google.complete(
      request.sessionID,
      input.body.flowId,
      input.body.idToken,
      request.user,
    );

    if (completed.pending) {
      response.status(202).json(completed.pending);
    } else {
      await this.responses.send(request, response, completed.user!);
    }
  }

  async verifyGoogleEmail(request: Request, response: Response, input: VerifyGoogleEmailInput) {
    const user = await this.google.emailComplete(request.sessionID, input.body.flowId, input.body.code, request.user);

    await this.responses.send(request, response, user);
  }

  async unlinkGoogle(request: IdentifiedRequest, response: Response, input: UnlinkGoogleInput) {
    const user = request.user;
    const updated = await this.google.unlink(request.sessionID, user, input.params.id);
    const notificationSent = await this.notifications.notify(user.email, 'google_unlinked');

    await this.responses.send(request, response, updated, { notificationSent });
  }
}
