import { defineRoute } from '@visomi-stack/web-backend-shared';
import { z } from 'zod';

import { emailSchema } from '../email/schema';
import { loginPasswordSchema, newPasswordSchema } from '../password/schema';
import {
  commonErrors,
  csrfSecurity,
  emptyBody,
  factorPendingSchema,
  factorSchema,
  identifierSchema,
  mutationDescription,
  notifiedSessionSchema,
  pendingSchema,
  sessionSchema,
  validationErrors,
} from '../shared/contracts';

export const passwordContracts = {
  signUp: defineRoute({
    validationErrors,
    method: 'post',
    path: '/password/sign-up',
    operationId: 'password_signUp',
    summary: 'Create a password account',
    tags: ['password'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ email: emailSchema, password: newPasswordSchema }) }),
    responses: {
      ...commonErrors,
      201: {
        description: 'Unverified session and email proof.',
        content: { 'application/json': { schema: sessionSchema.extend(pendingSchema.shape) } },
      },
    },
  }),
  signIn: defineRoute({
    validationErrors,
    method: 'post',
    path: '/password/sign-in',
    operationId: 'password_signIn',
    summary: 'Start password login',
    tags: ['password'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ email: emailSchema, password: loginPasswordSchema }) }),
    responses: {
      ...commonErrors,
      202: {
        description: 'Password accepted; prove the server-selected second factor.',
        content: { 'application/json': { schema: factorPendingSchema } },
      },
    },
  }),
  verifySignIn: defineRoute({
    validationErrors,
    method: 'post',
    path: '/password/verify',
    operationId: 'password_verifySignIn',
    summary: 'Complete password login',
    tags: ['password'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ flowId: identifierSchema, factor: factorSchema }) }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Authenticated or email-verified session.',
        content: { 'application/json': { schema: sessionSchema } },
      },
    },
  }),
  startReauthentication: defineRoute({
    validationErrors,
    method: 'post',
    path: '/reauth/password/start',
    operationId: 'password_startReauthentication',
    summary: 'Start password reauthentication',
    tags: ['password'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ password: loginPasswordSchema }) }),
    responses: {
      ...commonErrors,
      202: {
        description: 'Password reauthentication requires a second factor.',
        content: { 'application/json': { schema: factorPendingSchema } },
      },
    },
  }),
  completeReauthentication: defineRoute({
    validationErrors,
    method: 'post',
    path: '/reauth/password/complete',
    operationId: 'password_completeReauthentication',
    summary: 'Complete password reauthentication',
    tags: ['password'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ flowId: identifierSchema, factor: factorSchema }) }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Session with a recent authentication proof.',
        content: { 'application/json': { schema: sessionSchema } },
      },
    },
  }),
  addPassword: defineRoute({
    validationErrors,
    method: 'post',
    path: '/password/add',
    operationId: 'password_addPassword',
    summary: 'Add a password',
    tags: ['password'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ password: newPasswordSchema }) }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Password added after recent authentication.',
        content: { 'application/json': { schema: notifiedSessionSchema } },
      },
    },
  }),
  changePassword: defineRoute({
    validationErrors,
    method: 'post',
    path: '/password/change',
    operationId: 'password_changePassword',
    summary: 'Change a password',
    tags: ['password'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ password: newPasswordSchema }) }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Password changed and other sessions revoked.',
        content: { 'application/json': { schema: notifiedSessionSchema } },
      },
    },
  }),
  removePassword: defineRoute({
    validationErrors,
    method: 'post',
    path: '/password/remove',
    operationId: 'password_removePassword',
    summary: 'Remove a password',
    tags: ['password'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: emptyBody }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Password removed; another usable primary method must remain.',
        content: { 'application/json': { schema: notifiedSessionSchema } },
      },
      204: { description: 'Current password-authenticated session ended.' },
    },
  }),
};
