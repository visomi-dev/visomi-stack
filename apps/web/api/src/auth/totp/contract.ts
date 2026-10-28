import { defineRoute } from '@visomi-stack/web-backend-shared';
import { z } from 'zod';

import {
  codeSchema,
  commonErrors,
  csrfSecurity,
  emptyBody,
  identifierSchema,
  mutationDescription,
  notifiedSessionSchema,
  sessionSchema,
  validationErrors,
} from '../shared/contracts';

export const totpContracts = {
  setupTotp: defineRoute({
    validationErrors,
    method: 'post',
    path: '/totp/setup',
    operationId: 'totp_setupTotp',
    summary: 'Prepare TOTP enrollment',
    tags: ['totp'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: emptyBody }),
    responses: {
      ...commonErrors,
      201: {
        description: 'Pending enrollment; dedicated encryption key and recent authentication required.',
        content: {
          'application/json': {
            schema: z.object({ enrollmentId: identifierSchema, secret: z.string(), uri: z.string() }),
          },
        },
      },
    },
  }),
  confirmTotp: defineRoute({
    validationErrors,
    method: 'post',
    path: '/totp/confirm',
    operationId: 'totp_confirmTotp',
    summary: 'Confirm TOTP enrollment',
    tags: ['totp'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ enrollmentId: identifierSchema, code: codeSchema }) }),
    responses: {
      ...commonErrors,
      200: {
        description: 'TOTP activated; ten backup codes shown once.',
        content: {
          'application/json': {
            schema: notifiedSessionSchema.extend({ recoveryCodes: z.array(z.string()).length(10) }),
          },
        },
      },
    },
  }),
  removeTotp: defineRoute({
    validationErrors,
    method: 'delete',
    path: '/totp',
    operationId: 'totp_removeTotp',
    summary: 'Disable TOTP',
    tags: ['totp'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({}),
    responses: {
      ...commonErrors,
      200: {
        description: 'TOTP and backup codes disabled after recent authentication.',
        content: { 'application/json': { schema: notifiedSessionSchema } },
      },
    },
  }),
  regenerateRecoveryCodes: defineRoute({
    validationErrors,
    method: 'post',
    path: '/recovery-codes/regenerate',
    operationId: 'totp_regenerateRecoveryCodes',
    summary: 'Replace backup codes',
    tags: ['totp'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: emptyBody }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Ten new backup codes replace the previous set.',
        content: {
          'application/json': { schema: sessionSchema.extend({ recoveryCodes: z.array(z.string()).length(10) }) },
        },
      },
    },
  }),
};

export type ConfirmTotpInput = z.output<typeof totpContracts.confirmTotp.request>;
