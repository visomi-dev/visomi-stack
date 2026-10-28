import { randomBytes } from 'node:crypto';

import { inject } from '@visomi-stack/backend-shared';
import type { Request, Response } from 'express';

import type { IdentifiedRequest } from '../shared/http';
import { SessionResponses } from '../sessions/response';
import { Sessions } from '../sessions/service';
import { AUTH_CONFIG, type AuthConfig } from '../shared/config';
import { saveSession, sessionView } from '../shared/http';

import type { CloseSessionInput } from './contract';

export class SessionsController {
  private readonly sessions = inject(Sessions);
  private readonly responses = inject(SessionResponses);
  private readonly config = inject<AuthConfig>(AUTH_CONFIG);

  async listSessions(request: IdentifiedRequest, response: Response) {
    const sessions = await this.sessions.listSessions(request.sessionID, request.user);

    response.json({ sessions });
  }

  async closeSession(request: IdentifiedRequest, response: Response, input: CloseSessionInput) {
    const self = await this.sessions.closeSessions(request.sessionID, request.user, input.params.id);

    if (self) {
      response.clearCookie(this.config.cookieName, { path: '/' });
    }

    response.status(204).end();
  }

  async revokeOtherSessions(request: IdentifiedRequest, response: Response) {
    await this.sessions.closeSessions(request.sessionID, request.user);

    response.status(204).end();
  }

  async getSession(request: Request, response: Response) {
    request.session.csrf ??= randomBytes(32).toString('base64url');

    await saveSession(request);

    response.json(sessionView(request));
  }

  async logout(request: Request, response: Response) {
    await this.responses.send(request, response, null);
  }
}
