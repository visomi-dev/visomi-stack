import { inject } from '@visomi-stack/backend-shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import { Devices } from '../devices/service';
import { SessionResponses } from '../sessions/response';
import { requireAnonymousSession, requirePrincipal } from '../shared/http';

import { devicesContracts } from './contract';

export class DevicesController {
  private readonly devices = inject(Devices);
  private readonly responses = inject(SessionResponses);

  async requestApproval(
    request: Request,
    response: Response,
    input: z.output<typeof devicesContracts.requestApproval.request>,
  ) {
    requireAnonymousSession(request);

    const pending = await this.devices.request(request.sessionID, input.body.email);

    response.status(201).json(pending);
  }

  async getApprovalStatus(
    request: Request,
    response: Response,
    input: z.output<typeof devicesContracts.getApprovalStatus.request>,
  ) {
    const state = await this.devices.status(request.sessionID, input.body.requestId);

    response.json(state);
  }

  async reviewApproval(
    request: Request,
    response: Response,
    input: z.output<typeof devicesContracts.reviewApproval.request>,
  ) {
    const state = await this.devices.review(request.sessionID, requirePrincipal(request), input.body.requestId);

    response.json(state);
  }

  async cancelApproval(
    request: Request,
    response: Response,
    input: z.output<typeof devicesContracts.cancelApproval.request>,
  ) {
    await this.devices.cancel(request.sessionID, input.body.requestId);
    response.status(204).end();
  }

  async consumeApproval(
    request: Request,
    response: Response,
    input: z.output<typeof devicesContracts.consumeApproval.request>,
  ) {
    const user = await this.devices.consume(request.sessionID, input.body.requestId, input.body.userCode);

    await this.responses.send(request, response, user);
  }

  async approve(request: Request, response: Response, input: z.output<typeof devicesContracts.approve.request>) {
    await this.devices.decide(
      request.sessionID,
      requirePrincipal(request),
      input.body.requestId,
      true,
      input.body.userCode,
    );
    response.status(204).end();
  }

  async deny(request: Request, response: Response, input: z.output<typeof devicesContracts.deny.request>) {
    await this.devices.decide(
      request.sessionID,
      requirePrincipal(request),
      input.body.requestId,
      false,
      input.body.userCode,
    );
    response.status(204).end();
  }
}
