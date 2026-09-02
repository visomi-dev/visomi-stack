import { challengeIdSchema, emailSchema, pinSchema, responseEnvelope, z } from '../shared/http/route-schemas';

export const authUserSchema = z
  .object({
    accountId: z
      .string()
      .meta({ description: 'Active account identifier.', example: 'account-123', id: 'AuthAccountId' }),
    email: emailSchema,
    emailVerifiedAt: z.string().nullable().meta({
      description: 'Verification timestamp.',
      example: '2026-01-01T00:00:00.000Z',
      id: 'AuthEmailVerifiedAt',
    }),
    id: z.string().meta({ description: 'User identifier.', example: 'user-123', id: 'AuthUserId' }),
    role: z.string().meta({ description: 'Active account role.', example: 'owner', id: 'AuthRole' }),
  })
  .meta({ id: 'AuthUser' });

export const challengeSchema = z
  .object({
    challengeId: challengeIdSchema,
    email: emailSchema,
    expiresAt: z.string().meta({ description: 'Challenge expiry timestamp.', example: '2026-01-01T00:10:00.000Z' }),
    purpose: z.literal('bootstrap_recovery').meta({ description: 'Challenge purpose.', example: 'bootstrap_recovery' }),
  })
  .meta({ id: 'AuthChallenge' });

export type AuthUser = z.infer<typeof authUserSchema>;
export type VerificationPurpose = z.infer<typeof challengeSchema>['purpose'];
export type AuthChallengePayload = z.infer<typeof challengeSchema>;

export const emailOtpRequestSchema = z
  .object({
    email: emailSchema,
  })
  .meta({ id: 'EmailOtpRequest' });

export const emailOtpVerifySchema = z
  .object({
    flowId: challengeIdSchema,
    pin: pinSchema,
  })
  .meta({ id: 'EmailOtpVerify' });

export const emailOtpResendSchema = z
  .object({
    flowId: challengeIdSchema,
  })
  .meta({ id: 'EmailOtpResend' });

export const sessionResponseSchema = z
  .object({
    authenticated: z.boolean(),
    user: authUserSchema.nullable(),
  })
  .meta({ id: 'AuthSessionResponse' });

export const authenticatedResponseSchema = z
  .object({
    authenticated: z.literal(true),
    user: authUserSchema,
  })
  .meta({ id: 'AuthenticatedResponse' });

export const messageResponseSchema = z
  .object({
    message: z.string(),
  })
  .meta({ id: 'MessageResponse' });

export const restrictedSessionSchema = z
  .object({
    kind: z.literal('restricted'),
    user: authUserSchema,
    flowId: challengeIdSchema,
  })
  .meta({ id: 'AuthRestrictedSession' });

export const fullSessionSchema = z
  .object({
    kind: z.literal('full'),
    user: authUserSchema,
  })
  .meta({ id: 'AuthFullSession' });

export const sessionUpgradeSchema = z.union([restrictedSessionSchema, fullSessionSchema]).meta({
  id: 'AuthSessionUpgrade',
});

const rateLimitResponse = {
  429: {
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
    description: 'Too many attempts or requests; retry after the cooldown.',
  },
};

export const authOpenApiPaths = {
  '/auth/email-otp/request': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: emailOtpRequestSchema } } },
      responses: {
        202: {
          content: {
            'application/json': {
              schema: responseEnvelope(
                z.object({ flowId: challengeIdSchema, resendAvailableAt: z.string() }).strict(),
                'EmailOtpRequestedEnvelope',
              ),
            },
          },
          description: 'Email OTP requested.',
        },
        ...rateLimitResponse,
      },
    },
  },
  '/auth/email-otp/verify': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: emailOtpVerifySchema } } },
      responses: {
        200: {
          content: {
            'application/json': { schema: responseEnvelope(sessionUpgradeSchema, 'EmailOtpVerifiedEnvelope') },
          },
          description: 'Email OTP verified; restricted or full session returned.',
        },
        401: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
          description: 'Invalid PIN.',
        },
        409: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
          description: 'Multiple accounts share the email.',
        },
        ...rateLimitResponse,
      },
    },
  },
  '/auth/email-otp/resend': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: emailOtpResendSchema } } },
      responses: {
        202: {
          content: {
            'application/json': {
              schema: responseEnvelope(
                z.object({ flowId: challengeIdSchema, resendAvailableAt: z.string() }).strict(),
                'EmailOtpResentEnvelope',
              ),
            },
          },
          description: 'Email OTP resent.',
        },
        ...rateLimitResponse,
      },
    },
  },
  '/auth/session': {
    get: {
      responses: {
        200: {
          content: { 'application/json': { schema: responseEnvelope(sessionResponseSchema, 'AuthSessionEnvelope') } },
          description: 'Current authentication session.',
        },
      },
    },
  },
  '/auth/sign-out': {
    post: {
      responses: { 204: { description: 'Signed out.' } },
    },
  },
};
