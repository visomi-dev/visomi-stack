import { defineRoute } from '@visomi-stack/web-backend-shared';
import { z } from 'zod';

import {
  commonErrors,
  csrfSecurity,
  identifierSchema,
  identityParams,
  mutationDescription,
  notifiedSessionSchema,
  pendingSchema,
  sessionSchema,
  validationErrors,
  verificationBody,
} from '../shared/contracts';

function defaultIntent(value: 'login' | 'link' | 'reauth' | null | undefined) {
  return value ?? 'login';
}

export const googleContracts = {
  startGoogle: defineRoute({
    validationErrors,
    method: 'post',
    path: '/google/start',
    operationId: 'google_startGoogle',
    summary: 'Start Google authentication',
    tags: ['google'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({
      body: z.strictObject({
        intent: z.enum(['login', 'link', 'reauth'], { error: 'intent_invalid' }).nullish().transform(defaultIntent),
      }),
    }),
    responses: {
      ...commonErrors,
      201: {
        description: 'Session-bound Google nonce; provider must be configured.',
        content: { 'application/json': { schema: pendingSchema.extend({ nonce: z.string(), clientId: z.string() }) } },
      },
    },
  }),
  completeGoogle: defineRoute({
    validationErrors,
    method: 'post',
    path: '/google/complete',
    operationId: 'google_completeGoogle',
    summary: 'Verify a Google ID token',
    tags: ['google'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ flowId: identifierSchema, idToken: z.string().min(1).max(16384) }) }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Authenticated session or explicitly linked provider.',
        content: { 'application/json': { schema: sessionSchema } },
      },
      202: {
        description: 'External Google email requires our own proof.',
        content: { 'application/json': { schema: pendingSchema.extend({ factor: z.literal('email') }) } },
      },
    },
  }),
  verifyGoogleEmail: defineRoute({
    validationErrors,
    method: 'post',
    path: '/google/email/verify',
    operationId: 'google_verifyGoogleEmail',
    summary: 'Verify an external Google email',
    tags: ['google'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: verificationBody }),
    responses: {
      ...commonErrors,
      200: {
        description: 'External Google email proved and session established.',
        content: { 'application/json': { schema: sessionSchema } },
      },
    },
  }),
  unlinkGoogle: defineRoute({
    validationErrors,
    method: 'delete',
    path: '/google/:id',
    operationId: 'google_unlinkGoogle',
    summary: 'Unlink Google',
    tags: ['google'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ params: identityParams }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Provider removed after recent authentication.',
        content: { 'application/json': { schema: notifiedSessionSchema } },
      },
      204: { description: 'Current Google-authenticated session ended.' },
    },
  }),
};

export type StartGoogleInput = z.output<typeof googleContracts.startGoogle.request>;
export type CompleteGoogleInput = z.output<typeof googleContracts.completeGoogle.request>;
export type VerifyGoogleEmailInput = z.output<typeof googleContracts.verifyGoogleEmail.request>;
export type UnlinkGoogleInput = z.output<typeof googleContracts.unlinkGoogle.request>;
