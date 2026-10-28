import { defineRoute } from '@visomi-stack/web-backend-shared';
import { z } from 'zod';

import { commonErrors, cookieSecurity, identifierSchema, validationErrors } from '../shared/contracts';

const methodOverviewSchema = z.object({
  password: z.boolean(),
  google: z.array(z.object({ id: identifierSchema })),
  passkeys: z.array(z.object({ id: identifierSchema, label: z.string() })),
  totp: z.boolean(),
});

export const methodsContracts = {
  getProviders: defineRoute({
    validationErrors,
    method: 'get',
    path: '/providers',
    operationId: 'methods_getProviders',
    summary: 'Read authentication provider availability',
    tags: ['methods'],
    security: [],
    request: z.object({}),
    responses: {
      ...commonErrors,
      200: {
        description: 'Only public capabilities and the optional Google client ID.',
        content: {
          'application/json': {
            schema: z.object({
              passkey: z.literal(true),
              password: z.literal(true),
              google: z.object({ enabled: z.boolean(), clientId: z.string().nullable() }),
              totp: z.boolean(),
            }),
          },
        },
      },
    },
  }),
  getMethods: defineRoute({
    validationErrors,
    method: 'get',
    path: '/methods',
    operationId: 'methods_getMethods',
    summary: 'List authentication methods',
    tags: ['methods'],
    description: 'Requires a full verified session where documented; recent proof is required for management changes.',
    security: cookieSecurity,
    request: z.object({}),
    responses: {
      ...commonErrors,
      200: {
        description: 'Active primary methods and TOTP enrollment.',
        content: { 'application/json': { schema: methodOverviewSchema } },
      },
    },
  }),
};
