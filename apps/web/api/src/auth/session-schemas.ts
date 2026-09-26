import { errorResponses, responseEnvelope, z } from '../shared/http/route-schemas';

export const sessionRevokeSchema = z
  .object({
    grantId: z.string().min(1),
    id: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const sessionRevokeOthersSchema = z.object({ grantId: z.string().min(1) }).strict();

const sessionSchema = z.object({
  id: z.string(),
  current: z.boolean(),
  startedAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  method: z.enum(['password', 'passkey', 'google', 'unknown']),
});
const revokedResponse = {
  ...errorResponses,
  200: {
    description: 'Revocation completed.',
    content: {
      'application/json': {
        schema: responseEnvelope(z.object({ revoked: z.number().int().nonnegative() }), 'SessionRevocationEnvelope'),
      },
    },
  },
};

export const sessionPaths = {
  '/auth/sessions': {
    get: {
      responses: {
        ...errorResponses,
        200: {
          description: 'Current authenticated sessions.',
          content: {
            'application/json': {
              schema: responseEnvelope(z.array(sessionSchema), 'SessionsEnvelope'),
            },
          },
        },
      },
    },
  },
  '/auth/sessions/revoke': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: sessionRevokeSchema } } },
      responses: revokedResponse,
    },
  },
  '/auth/sessions/revoke-others': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: sessionRevokeOthersSchema } } },
      responses: revokedResponse,
    },
  },
};
