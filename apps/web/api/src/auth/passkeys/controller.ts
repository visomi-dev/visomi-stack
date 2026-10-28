import { inject } from '@visomi-stack/backend-shared';
import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';
import type { Request, Response } from 'express';

import type { IdentifiedRequest } from '../shared/http';
import { EmailIdentity } from '../email/service';
import { Passkeys } from '../passkeys/service';
import { SessionResponses } from '../sessions/response';
import { sessionView } from '../shared/http';
import { SecurityNotifications } from '../shared/notifications';

import type {
  AuthenticatePasskeyInput,
  RegisterPasskeyInput,
  RegistrationOptionsInput,
  RenamePasskeyInput,
  RevokePasskeyInput,
} from './contract';

export class PasskeysController {
  private readonly passkeys = inject(Passkeys);
  private readonly email = inject(EmailIdentity);
  private readonly notifications = inject(SecurityNotifications);
  private readonly responses = inject(SessionResponses);

  async registrationOptions(request: Request, response: Response, input: RegistrationOptionsInput) {
    if (request.user && Object.keys(input.body).length) {
      throw new HttpError(400, 'request_invalid');
    }

    const email = 'email' in input.body ? input.body.email : undefined;

    if (!request.user && !email) {
      throw new HttpError(400, 'email_invalid');
    }

    const result = await this.passkeys.registrationOptions(request.sessionID, request.user, email);

    response.json(result);
  }

  async registerPasskey(request: Request, response: Response, input: RegisterPasskeyInput) {
    const result = await this.passkeys.register(
      request.sessionID,
      input.body.challengeId,
      input.body.response,
      input.body.label === undefined ? 'Passkey' : input.body.label,
      request.user,
    );

    await this.responses.establish(request, result);

    let verification = {};

    if (result.level === 'unverified' && result.email) {
      const result1 = await this.email.emailStart(request.sessionID, result);

      verification = result1;
    }

    response.status(201).json({ ...sessionView(request), ...verification });
  }

  async authenticationOptions(request: Request, response: Response) {
    const result = await this.passkeys.authenticationOptions(request.sessionID);

    response.json(result);
  }

  async authenticatePasskey(request: Request, response: Response, input: AuthenticatePasskeyInput) {
    const result = await this.passkeys.authenticate(
      request.sessionID,
      input.body.challengeId,
      input.body.response,
      request.user?.grantId ? request.user : undefined,
    );

    if (request.user && request.user.id !== result.id) {
      throw new AuthHttpError(403, 'identity_mismatch');
    }

    const recovering = Boolean(request.user?.grantId);

    await this.responses.establish(request, result);

    if (recovering && result.level === 'full') {
      await this.notifications.notify(result.email, 'passkey_recovered');
    }

    response.json(sessionView(request));
  }

  async listPasskeys(request: IdentifiedRequest, response: Response) {
    const result = await this.passkeys.list(request.user);

    response.json({ credentials: result });
  }

  async renamePasskey(request: IdentifiedRequest, response: Response, input: RenamePasskeyInput) {
    await this.passkeys.rename(request.sessionID, request.user, input.params.id, input.body.label);

    response.status(204).end();
  }

  async revokePasskey(request: IdentifiedRequest, response: Response, input: RevokePasskeyInput) {
    await this.passkeys.revoke(request.sessionID, request.user, input.params.id);

    response.status(204).end();
  }
}
