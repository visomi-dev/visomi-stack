import { defineRoute } from '@visomi-stack/web-backend-shared';
import { z } from 'zod';

import { emailSchema } from '../email/schema';
import {
  commonErrors,
  csrfSecurity,
  flowBody,
  mutationDescription,
  notifiedSessionSchema,
  pendingSchema,
  sessionSchema,
  validationErrors,
  verificationBody,
} from '../shared/contracts';

export const emailContracts = {
  requestVerification: defineRoute({
    validationErrors,
    method: 'post',
    path: '/email/request',
    operationId: 'email_requestVerification',
    summary: 'Request email verification',
    tags: ['email'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ email: emailSchema.optional() }) }),
    responses: {
      ...commonErrors,
      202: {
        description: 'Email verification proof issued; shared cooldown applies.',
        content: { 'application/json': { schema: pendingSchema } },
      },
    },
  }),
  verifyEmail: defineRoute({
    validationErrors,
    method: 'post',
    path: '/email/verify',
    operationId: 'email_verifyEmail',
    summary: 'Verify account email',
    tags: ['email'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: verificationBody }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Email verified and session upgraded.',
        content: { 'application/json': { schema: sessionSchema } },
      },
    },
  }),
  requestEmailChange: defineRoute({
    validationErrors,
    method: 'post',
    path: '/email/change/request',
    operationId: 'email_requestEmailChange',
    summary: 'Request an email change',
    tags: ['email'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ email: emailSchema }) }),
    responses: {
      ...commonErrors,
      202: {
        description: 'New email proof issued after recent authentication.',
        content: { 'application/json': { schema: pendingSchema } },
      },
    },
  }),
  verifyEmailChange: defineRoute({
    validationErrors,
    method: 'post',
    path: '/email/change/verify',
    operationId: 'email_verifyEmailChange',
    summary: 'Complete an email change',
    tags: ['email'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: verificationBody }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Email changed, stale proofs revoked and previous address notified.',
        content: { 'application/json': { schema: notifiedSessionSchema } },
      },
    },
  }),
  resendChallenge: defineRoute({
    validationErrors,
    method: 'post',
    path: '/challenges/resend',
    operationId: 'email_resendChallenge',
    summary: 'Resend an email challenge',
    tags: ['email'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: flowBody }),
    responses: {
      ...commonErrors,
      202: {
        description: 'Replacement proof retains original expiry and attempt budget.',
        content: { 'application/json': { schema: pendingSchema } },
      },
    },
  }),
};

export type RequestVerificationInput = z.output<typeof emailContracts.requestVerification.request>;
export type VerifyEmailInput = z.output<typeof emailContracts.verifyEmail.request>;
export type RequestEmailChangeInput = z.output<typeof emailContracts.requestEmailChange.request>;
export type VerifyEmailChangeInput = z.output<typeof emailContracts.verifyEmailChange.request>;
export type ResendChallengeInput = z.output<typeof emailContracts.resendChallenge.request>;
