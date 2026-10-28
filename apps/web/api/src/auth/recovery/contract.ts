import { defineRoute } from '@visomi-stack/web-backend-shared';
import { z } from 'zod';

import { emailSchema } from '../email/schema';
import { loginPasswordSchema, newPasswordSchema } from '../password/schema';
import {
  commonErrors,
  csrfSecurity,
  factorPendingSchema,
  factorSchema,
  identifierSchema,
  mutationDescription,
  notifiedSessionSchema,
  pendingSchema,
  validationErrors,
  verificationBody,
} from '../shared/contracts';

export const recoveryContracts = {
  requestRecovery: defineRoute({
    validationErrors,
    method: 'post',
    path: '/recovery/request',
    operationId: 'recovery_requestRecovery',
    summary: 'Request account recovery',
    tags: ['recovery'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ email: emailSchema }) }),
    responses: {
      ...commonErrors,
      202: {
        description: 'Uniform response for known and unknown identities.',
        content: { 'application/json': { schema: pendingSchema } },
      },
    },
  }),
  verifyRecovery: defineRoute({
    validationErrors,
    method: 'post',
    path: '/recovery/verify',
    operationId: 'recovery_verifyRecovery',
    summary: 'Verify recovery permission',
    tags: ['recovery'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: verificationBody.extend({ factor: factorSchema.optional() }) }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Restricted enrollment session; active TOTP requires an additional proof.',
        content: { 'application/json': { schema: notifiedSessionSchema } },
      },
    },
  }),
  requestReset: defineRoute({
    validationErrors,
    method: 'post',
    path: '/password/reset/request',
    operationId: 'recovery_requestReset',
    summary: 'Request password reset',
    tags: ['recovery'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ email: emailSchema }) }),
    responses: {
      ...commonErrors,
      202: {
        description: 'Uniform reset response without revealing account existence.',
        content: { 'application/json': { schema: pendingSchema } },
      },
    },
  }),
  completeReset: defineRoute({
    validationErrors,
    method: 'post',
    path: '/password/reset/complete',
    operationId: 'recovery_completeReset',
    summary: 'Complete password reset',
    tags: ['recovery'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({
      body: verificationBody.extend({ factor: factorSchema.optional(), password: newPasswordSchema }),
    }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Password reset without granting a full login.',
        content: {
          'application/json': { schema: z.object({ passwordReset: z.literal(true), notificationSent: z.boolean() }) },
        },
      },
    },
  }),
  stagePassword: defineRoute({
    validationErrors,
    method: 'post',
    path: '/recovery/password',
    operationId: 'recovery_stagePassword',
    summary: 'Stage a recovery password',
    tags: ['recovery'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ password: newPasswordSchema }) }),
    responses: {
      ...commonErrors,
      202: {
        description: 'Replacement password staged for a restricted enrollment grant.',
        content: { 'application/json': { schema: factorPendingSchema } },
      },
    },
  }),
  completePassword: defineRoute({
    validationErrors,
    method: 'post',
    path: '/recovery/password/complete',
    operationId: 'recovery_completePassword',
    summary: 'Prove a recovery password',
    tags: ['recovery'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({
      body: z.strictObject({ flowId: identifierSchema, password: loginPasswordSchema, factor: factorSchema }),
    }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Replacement password proved; old sessions and grants revoked.',
        content: { 'application/json': { schema: notifiedSessionSchema } },
      },
    },
  }),
};
