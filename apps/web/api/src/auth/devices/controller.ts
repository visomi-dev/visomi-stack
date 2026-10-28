import { inject } from '@visomi-stack/backend-shared';
import type { Request, Response } from 'express';

import type { IdentifiedRequest } from '../shared/http';
import { Devices } from '../devices/service';
import { SessionResponses } from '../sessions/response';

import type {
  ApproveInput,
  CancelApprovalInput,
  ConsumeApprovalInput,
  DenyInput,
  GetApprovalStatusInput,
  RequestApprovalInput,
  ReviewApprovalInput,
} from './contract';

export class DevicesController {
  private readonly devices = inject(Devices);
  private readonly responses = inject(SessionResponses);

  async requestApproval(request: Request, response: Response, input: RequestApprovalInput) {
    const pending = await this.devices.request(request.sessionID, input.body.email);

    response.status(201).json(pending);
  }

  async getApprovalStatus(request: Request, response: Response, input: GetApprovalStatusInput) {
    const state = await this.devices.status(request.sessionID, input.body.requestId);

    response.json(state);
  }

  async reviewApproval(request: IdentifiedRequest, response: Response, input: ReviewApprovalInput) {
    const state = await this.devices.review(request.sessionID, request.user, input.body.requestId);

    response.json(state);
  }

  async cancelApproval(request: Request, response: Response, input: CancelApprovalInput) {
    await this.devices.cancel(request.sessionID, input.body.requestId);

    response.status(204).end();
  }

  async consumeApproval(request: Request, response: Response, input: ConsumeApprovalInput) {
    const user = await this.devices.consume(request.sessionID, input.body.requestId, input.body.userCode);

    await this.responses.send(request, response, user);
  }

  async approve(request: IdentifiedRequest, response: Response, input: ApproveInput) {
    await this.devices.decide(request.sessionID, request.user, input.body.requestId, true, input.body.userCode);

    response.status(204).end();
  }

  async deny(request: IdentifiedRequest, response: Response, input: DenyInput) {
    await this.devices.decide(request.sessionID, request.user, input.body.requestId, false, input.body.userCode);

    response.status(204).end();
  }
}
