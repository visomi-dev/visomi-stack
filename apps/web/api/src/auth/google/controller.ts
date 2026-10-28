import { inject } from '@visomi-stack/backend-shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import { Google } from '../google/service';
import { SessionResponses } from '../sessions/response';
import { requireAnonymousSession, requirePrincipal } from '../shared/http';
import { SecurityNotifications } from '../shared/notifications';

import { googleContracts } from './contract';

export class GoogleController {
  private readonly google = inject(Google);
  private readonly notifications = inject(SecurityNotifications);
  private readonly responses = inject(SessionResponses);

  async startGoogle(request: Request, response: Response, input: z.output<typeof googleContracts.startGoogle.request>) {
    const intent = input.body.intent;

    if (intent === 'login') {
      requireAnonymousSession(request);
    }

    const pending = await this.google.start(request.sessionID, intent, request.user);

    response.status(201).json(pending);
  }

  async completeGoogle(
    request: Request,
    response: Response,
    input: z.output<typeof googleContracts.completeGoogle.request>,
  ) {
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

  async verifyGoogleEmail(
    request: Request,
    response: Response,
    input: z.output<typeof googleContracts.verifyGoogleEmail.request>,
  ) {
    const user = await this.google.emailComplete(request.sessionID, input.body.flowId, input.body.code, request.user);

    await this.responses.send(request, response, user);
  }

  async unlinkGoogle(
    request: Request,
    response: Response,
    input: z.output<typeof googleContracts.unlinkGoogle.request>,
  ) {
    const user = requirePrincipal(request);
    const updated = await this.google.unlink(request.sessionID, user, input.params.id);
    const notificationSent = await this.notifications.notify(user.email, 'google_unlinked');

    await this.responses.send(request, response, updated, { notificationSent });
  }
}
