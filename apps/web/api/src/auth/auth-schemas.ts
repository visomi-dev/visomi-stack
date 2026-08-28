import {
  challengeIdSchema,
  emailSchema,
  passwordSchema,
  pinSchema,
  responseEnvelope,
  z,
} from '../shared/http/route-schemas';

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
    authenticationMethod: z.enum(['passkey', 'password']).optional(),
    credentialId: z.string().optional(),
  })
  .meta({ id: 'AuthUser' });

export const challengeSchema = z
  .object({
    challengeId: challengeIdSchema,
    email: emailSchema,
    expiresAt: z.string().meta({ description: 'Challenge expiry timestamp.', example: '2026-01-01T00:10:00.000Z' }),
    purpose: z
      .enum(['sign_in', 'sign_up', 'password_reset'])
      .meta({ description: 'Challenge purpose.', example: 'sign_up' }),
  })
  .meta({ id: 'AuthChallenge' });

export type AuthUser = z.infer<typeof authUserSchema>;
export type VerificationPurpose = z.infer<typeof challengeSchema>['purpose'];
export type AuthChallengePayload = z.infer<typeof challengeSchema>;

export const credentialsSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .meta({ id: 'AuthCredentials' });

export const challengeVerificationSchema = z
  .object({
    challengeId: challengeIdSchema,
    pin: pinSchema,
    rememberDevice: z.boolean().optional().default(false),
  })
  .meta({ id: 'AuthChallengeVerification' });

export const resendVerificationSchema = z
  .object({
    challengeId: challengeIdSchema,
  })
  .meta({ id: 'AuthResendVerification' });

export const forgottenPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .meta({ id: 'ForgottenPasswordRequest' });

export const passwordResetVerifySchema = challengeVerificationSchema.meta({
  id: 'PasswordResetVerify',
});

export const passwordResetSchema = z
  .object({
    password: passwordSchema,
  })
  .meta({ id: 'PasswordResetSubmit' });

export const passwordResetSessionSchema = z
  .object({
    active: z.boolean().meta({ description: 'Whether a reset session is currently active.' }),
    email: z.string().nullable().meta({ description: 'Email of the account being reset.' }),
  })
  .meta({ id: 'PasswordResetSession' });

export const securityPasswordSchema = z
  .object({
    password: passwordSchema.min(12).max(128),
    confirmPassword: z.string().max(128),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  })
  .meta({ id: 'SecurityPasswordSetup' });

export const securityPasswordStatusSchema = z
  .object({
    configured: z.boolean(),
    setupAvailable: z.boolean(),
  })
  .meta({ id: 'SecurityPasswordStatus' });

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

export const challengeOrAuthSchema = z
  .object({
    authenticated: z.literal(true),
    user: authUserSchema,
  })
  .or(challengeSchema)
  .meta({ id: 'AuthChallengeOrAuthenticated' });

const rateLimitResponse = {
  429: {
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
    description: 'Too many attempts or requests; retry after the cooldown.',
  },
};

export const authOpenApiPaths = {
  '/auth/security/password': {
    get: {
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(securityPasswordStatusSchema, 'SecurityPasswordStatusEnvelope'),
            },
          },
          description: 'Password status.',
        },
      },
    },
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: securityPasswordSchema } } },
      responses: { 204: { description: 'Password configured.' }, ...rateLimitResponse },
    },
  },
  '/auth/security/password/reauthenticate': {
    post: { responses: { 204: { description: 'Recent authentication recorded.' } } },
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
  '/auth/sign-up': {
    post: {
      requestBody: { content: { 'application/json': { schema: credentialsSchema } } },
      responses: {
        201: {
          content: { 'application/json': { schema: responseEnvelope(challengeSchema, 'AuthChallengeEnvelope') } },
          description: 'Sign-up challenge created.',
        },
      },
    },
  },
  '/auth/sign-up/verify': {
    post: {
      requestBody: { content: { 'application/json': { schema: challengeVerificationSchema } } },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(authenticatedResponseSchema, 'SignUpAuthenticatedEnvelope'),
            },
          },
          description: 'Sign-up verification complete.',
        },
        ...rateLimitResponse,
      },
    },
  },
  '/auth/sign-in/password': {
    post: {
      requestBody: { content: { 'application/json': { schema: credentialsSchema } } },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(challengeOrAuthSchema, 'AuthChallengeOrAuthenticatedEnvelope'),
            },
          },
          description: 'Sign-in challenge created or already verified.',
        },
      },
    },
  },
  '/auth/sign-in/verify': {
    post: {
      requestBody: { content: { 'application/json': { schema: challengeVerificationSchema } } },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(authenticatedResponseSchema, 'SignInAuthenticatedEnvelope'),
            },
          },
          description: 'Sign-in verification complete.',
        },
        ...rateLimitResponse,
      },
    },
  },
  '/auth/verification/resend': {
    post: {
      requestBody: { content: { 'application/json': { schema: resendVerificationSchema } } },
      responses: {
        200: {
          content: { 'application/json': { schema: responseEnvelope(challengeSchema, 'ResentAuthChallengeEnvelope') } },
          description: 'Verification challenge resent.',
        },
        ...rateLimitResponse,
      },
    },
  },
  '/auth/sign-out': {
    post: {
      responses: { 204: { description: 'Signed out.' } },
    },
  },
  '/auth/password/forgotten': {
    post: {
      requestBody: { content: { 'application/json': { schema: forgottenPasswordSchema } } },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(challengeSchema.nullable(), 'OptionalAuthChallengeEnvelope'),
            },
          },
          description: 'Password reset challenge created.',
        },
      },
    },
  },
  '/auth/password/reset/verify': {
    post: {
      requestBody: { content: { 'application/json': { schema: passwordResetVerifySchema } } },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(passwordResetSessionSchema, 'PasswordResetVerifyEnvelope'),
            },
          },
          description: 'Reset session established.',
        },
        ...rateLimitResponse,
      },
    },
  },
  '/auth/password/reset': {
    post: {
      requestBody: { content: { 'application/json': { schema: passwordResetSchema } } },
      responses: {
        204: { description: 'Password updated.' },
      },
    },
  },
  '/auth/password/reset/session': {
    get: {
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(passwordResetSessionSchema, 'PasswordResetSessionStateEnvelope'),
            },
          },
          description: 'Current reset session state.',
        },
      },
    },
  },
};
