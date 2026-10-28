import { createApiDocument, defineRoute } from '@visomi-stack/web-backend-shared';
import { z } from 'zod';

import { devicesContracts } from './auth/devices/contract';
import { emailContracts } from './auth/email/contract';
import { googleContracts } from './auth/google/contract';
import { methodsContracts } from './auth/methods/contract';
import { passkeysContracts } from './auth/passkeys/contract';
import { passwordContracts } from './auth/password/contract';
import { recoveryContracts } from './auth/recovery/contract';
import { sessionsContracts } from './auth/sessions/contract';
import { totpContracts } from './auth/totp/contract';

export const homeContract = defineRoute({
  method: 'get',
  path: '/',
  operationId: 'api_home',
  summary: 'API availability',
  tags: ['api'],
  security: [],
  request: z.object({}),
  responses: {
    200: {
      description: 'API is available.',
      content: { 'application/json': { schema: z.object({ message: z.literal('Hello API') }) } },
    },
  },
});
export const documentationContract = defineRoute({
  method: 'get',
  path: '/openapi.json',
  operationId: 'api_openapi',
  summary: 'OpenAPI document',
  tags: ['api'],
  security: [],
  request: z.object({}),
  responses: {
    200: {
      description: 'OpenAPI 3.1 document assembled without authentication resources.',
      content: {
        'application/json': {
          schema: z.looseObject({
            openapi: z.literal('3.1.0'),
            info: z.object({ title: z.string(), version: z.string() }),
            paths: z.record(z.string(), z.unknown()),
          }),
        },
      },
    },
  },
});

export const authContracts = [
  ...Object.values(passwordContracts),
  ...Object.values(emailContracts),
  ...Object.values(googleContracts),
  ...Object.values(totpContracts),
  ...Object.values(recoveryContracts),
  ...Object.values(devicesContracts),
  ...Object.values(methodsContracts),
  ...Object.values(sessionsContracts),
  ...Object.values(passkeysContracts),
].map((contract) => ({ ...contract, path: `/auth${contract.path}` }));

export function createOpenApiDocument(basePath = '/') {
  return createApiDocument({
    title: 'Visomi Stack API',
    version: '0.1.0',
    basePath,
    contracts: [homeContract, documentationContract, ...authContracts],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: '__Host-visomi.sid',
          description:
            'Secure host-only production session. A session may be anonymous, unverified or restricted; documented authorization rules still apply.',
        },
        localSessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'visomi.sid',
          description: 'Loopback HTTP development session.',
        },
        csrf: {
          type: 'apiKey',
          in: 'header',
          name: 'X-CSRF-Token',
          description:
            'Token from GET /auth/session, bound to the browser session. The configured Origin is also required.',
        },
      },
    },
  });
}
