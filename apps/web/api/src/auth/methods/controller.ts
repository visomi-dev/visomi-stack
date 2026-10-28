import { inject } from '@visomi-stack/backend-shared';
import type { Request, Response } from 'express';

import type { IdentifiedRequest } from '../shared/http';
import { Methods } from '../methods/service';
import { AUTH_CONFIG, type AuthConfig } from '../shared/config';

export class MethodsController {
  private readonly config = inject<AuthConfig>(AUTH_CONFIG);
  private readonly methods = inject(Methods);

  getProviders(_request: Request, response: Response): void {
    response.json({
      passkey: true,
      password: true,
      google: { enabled: Boolean(this.config.googleClientId), clientId: this.config.googleClientId ?? null },
      totp: Boolean(this.config.totpKey),
    });
  }

  async getMethods(request: IdentifiedRequest, response: Response) {
    const methods = await this.methods.overview(request.user);

    response.json(methods);
  }
}
