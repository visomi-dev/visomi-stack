import { Router } from 'express';

import type { AuthRuntime } from '../runtime';

import {
  cancelApproval,
  consumeApproval,
  decideApproval,
  getApprovalStatus,
  requestApproval,
  reviewApproval,
} from './controller';

export function createDeviceRouter(auth: AuthRuntime): Router {
  const router = Router();

  router.post('/device-approval/request', (request, response) => requestApproval(auth, request, response));
  router.post('/device-approval/status', (request, response) => getApprovalStatus(auth, request, response));
  router.post('/device-approval/review', (request, response) => reviewApproval(auth, request, response));
  router.post('/device-approval/approve', (request, response) => decideApproval(auth, request, response, 'approve'));
  router.post('/device-approval/deny', (request, response) => decideApproval(auth, request, response, 'deny'));
  router.post('/device-approval/cancel', (request, response) => cancelApproval(auth, request, response));
  router.post('/device-approval/consume', (request, response) => consumeApproval(auth, request, response));

  return router;
}
