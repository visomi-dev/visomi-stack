import { defineRoute } from '@visomi-stack/web-backend-shared';
import { z } from 'zod';

import { emailSchema } from '../email/schema';
import {
  codeSchema,
  commonErrors,
  csrfSecurity,
  expirySchema,
  identifierSchema,
  mutationDescription,
  sessionSchema,
  validationErrors,
} from '../shared/contracts';

const pairingBody = z.strictObject({ requestId: identifierSchema, userCode: codeSchema });
const deviceRequestSchema = z.object({ requestId: identifierSchema, userCode: z.string(), expiresAt: expirySchema });
const deviceStatusSchema = z.object({
  requestId: identifierSchema,
  status: z.enum(['requested', 'approved', 'denied', 'cancelled', 'consumed', 'expired']),
  expiresAt: expirySchema,
});

export const devicesContracts = {
  requestApproval: defineRoute({
    validationErrors,
    method: 'post',
    path: '/device-approval/request',
    operationId: 'devices_requestApproval',
    summary: 'Request approval from another device',
    tags: ['devices'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ email: emailSchema }) }),
    responses: {
      ...commonErrors,
      201: {
        description: 'Browser-bound approval request and pairing code.',
        content: { 'application/json': { schema: deviceRequestSchema } },
      },
    },
  }),
  getApprovalStatus: defineRoute({
    validationErrors,
    method: 'post',
    path: '/device-approval/status',
    operationId: 'devices_getApprovalStatus',
    summary: 'Read device approval status',
    tags: ['devices'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ requestId: identifierSchema }) }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Status visible to the requesting browser.',
        content: { 'application/json': { schema: deviceStatusSchema } },
      },
    },
  }),
  reviewApproval: defineRoute({
    validationErrors,
    method: 'post',
    path: '/device-approval/review',
    operationId: 'devices_reviewApproval',
    summary: 'Review device approval',
    tags: ['devices'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ requestId: identifierSchema }) }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Request reviewed by another full session.',
        content: { 'application/json': { schema: deviceStatusSchema } },
      },
    },
  }),
  approve: defineRoute({
    validationErrors,
    method: 'post',
    path: '/device-approval/approve',
    operationId: 'devices_approve',
    summary: 'Approve another device',
    tags: ['devices'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: pairingBody }),
    responses: {
      ...commonErrors,
      204: { description: 'Approved with a matching pairing code and recent authentication.' },
    },
  }),
  deny: defineRoute({
    validationErrors,
    method: 'post',
    path: '/device-approval/deny',
    operationId: 'devices_deny',
    summary: 'Deny another device',
    tags: ['devices'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: pairingBody }),
    responses: { ...commonErrors, 204: { description: 'Approval request denied.' } },
  }),
  cancelApproval: defineRoute({
    validationErrors,
    method: 'post',
    path: '/device-approval/cancel',
    operationId: 'devices_cancelApproval',
    summary: 'Cancel device approval',
    tags: ['devices'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ requestId: identifierSchema }) }),
    responses: { ...commonErrors, 204: { description: 'Request cancelled by its requesting browser.' } },
  }),
  consumeApproval: defineRoute({
    validationErrors,
    method: 'post',
    path: '/device-approval/consume',
    operationId: 'devices_consumeApproval',
    summary: 'Consume device approval',
    tags: ['devices'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: pairingBody }),
    responses: {
      ...commonErrors,
      200: {
        description: 'One-use approval grants restricted enrollment, not full access.',
        content: { 'application/json': { schema: sessionSchema } },
      },
    },
  }),
};

export type RequestApprovalInput = z.output<typeof devicesContracts.requestApproval.request>;
export type GetApprovalStatusInput = z.output<typeof devicesContracts.getApprovalStatus.request>;
export type ReviewApprovalInput = z.output<typeof devicesContracts.reviewApproval.request>;
export type ApproveInput = z.output<typeof devicesContracts.approve.request>;
export type DenyInput = z.output<typeof devicesContracts.deny.request>;
export type CancelApprovalInput = z.output<typeof devicesContracts.cancelApproval.request>;
export type ConsumeApprovalInput = z.output<typeof devicesContracts.consumeApproval.request>;
