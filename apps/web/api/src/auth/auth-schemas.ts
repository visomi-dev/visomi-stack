import { challengeIdSchema, emailSchema, pinSchema, responseEnvelope, z } from '../shared/http/route-schemas';

import { normalizePassword, validatePasswordPolicy } from './password';

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
    authenticationMethod: z.enum(['passkey', 'google', 'password']).optional(),
    secondFactor: z.enum(['email', 'totp', 'recovery_code']).optional(),
    authVersion: z.number().int().positive().optional(),
    credentialId: z.string().optional(),
  })
  .meta({ id: 'AuthUser' });

export type AuthUser = z.infer<typeof authUserSchema>;
export const challengeSchema = z.object({
  challengeId: challengeIdSchema,
  email: emailSchema,
  expiresAt: z.string(),
  purpose: z.enum([
    'bootstrap_recovery',
    'existing_account_recovery',
    'password_second_step',
    'password_signup',
    'password_reset',
  ]),
});
export type VerificationPurpose = z.infer<typeof challengeSchema>['purpose'];

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

export const restrictedAccountSelectSchema = z
  .object({ accountId: z.string().min(1) })
  .strict()
  .meta({ id: 'RestrictedAccountSelect' });

export const restrictedAccountChoiceSchema = z
  .object({ accountId: z.string(), name: z.string(), role: z.string(), selected: z.boolean() })
  .strict()
  .meta({ id: 'RestrictedAccountChoice' });

export const identityFlowIdSchema = z.string().uuid();
export const identityIdentifySchema = z.object({ flowId: identityFlowIdSchema, email: emailSchema }).strict();
export const identityStatusSchema = z.object({ flowId: identityFlowIdSchema }).strict();
export const recoveryVerifySchema = z.object({ flowId: identityFlowIdSchema, pin: pinSchema }).strict();
export const googleCompleteSchema = z.object({ flowId: identityFlowIdSchema, idToken: z.string().min(1) }).strict();
export const passwordSignInSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(512) })
  .strict()
  .meta({ id: 'PasswordSignIn' });
export const passwordVerifySchema = z
  .object({
    flowId: identityFlowIdSchema,
    code: z.string().min(1).max(128),
    kind: z.enum(['email', 'totp', 'recovery_code']),
  })
  .strict()
  .meta({ id: 'PasswordVerify' });
export const passwordResendSchema = z.object({ flowId: identityFlowIdSchema }).strict().meta({ id: 'PasswordResend' });
export const passwordSignUpSchema = z
  .object({
    email: emailSchema,
    password: z.string().max(512).transform(normalizePassword).refine(validatePasswordPolicy),
  })
  .strict()
  .meta({ id: 'PasswordSignUp' });
export const passwordSignUpVerifySchema = z
  .object({ flowId: identityFlowIdSchema, code: pinSchema })
  .strict()
  .meta({ id: 'PasswordSignUpVerify' });
export const passwordResetRequestSchema = z
  .object({ email: emailSchema })
  .strict()
  .meta({ id: 'PasswordResetRequest' });
export const passwordResetCompleteSchema = z
  .object({
    flowId: identityFlowIdSchema,
    emailCode: pinSchema,
    factor: z
      .object({ kind: z.enum(['totp', 'recovery_code']), code: z.string().min(1).max(128) })
      .strict()
      .optional(),
    password: z.string().max(512).transform(normalizePassword).refine(validatePasswordPolicy),
  })
  .strict()
  .meta({ id: 'PasswordResetComplete' });
export const passwordSignUpResponseSchema = z
  .object({ flowId: identityFlowIdSchema, expiresAt: z.string(), resendAvailableAt: z.string() })
  .strict()
  .meta({ id: 'PasswordSignUpResponse' });
export const passwordResetRequestResponseSchema = z
  .object({
    flowId: identityFlowIdSchema,
    requiredFactor: z.enum(['email', 'totp_or_recovery']),
    expiresAt: z.string(),
  })
  .strict()
  .meta({ id: 'PasswordResetRequestResponse' });
export const passwordResetResponseSchema = z
  .object({ passwordReset: z.literal(true) })
  .strict()
  .meta({ id: 'PasswordResetResponse' });
export const passwordSetSchema = z
  .object({
    password: z
      .string()
      .max(512)
      .transform(normalizePassword)
      .refine(validatePasswordPolicy, 'Password must be between 15 and 128 characters.'),
  })
  .strict()
  .meta({ id: 'PasswordSet' });
export const passwordSetResponseSchema = z
  .object({ passwordSet: z.literal(true) })
  .strict()
  .meta({ id: 'PasswordSetResponse' });
export const passwordChangeSchema = z
  .object({ currentPassword: z.string().min(1).max(512), password: passwordSetSchema.shape.password })
  .strict();
export const passwordRemoveSchema = z.object({ currentPassword: z.string().min(1).max(512) }).strict();
export const recoveryCodeSchema = z.object({ code: z.string().regex(/^[A-Z0-9-]{8,64}$/) }).strict();
export const reauthStartSchema = z
  .object({
    purpose: z.enum([
      'password_change',
      'password_remove',
      'totp_change',
      'totp_disable',
      'recovery_codes_regenerate',
      'google_link',
    ]),
  })
  .strict();
export const reauthCompleteSchema = z
  .object({
    grantId: identityFlowIdSchema,
    method: z.enum(['passkey', 'google', 'password', 'totp', 'recovery_code']),
    code: z.string().max(128).optional(),
    password: z.string().max(512).optional(),
    idToken: z.string().min(1).optional(),
  })
  .strict();
export const operationGrantSchema = z.object({ grantId: identityFlowIdSchema }).strict();
export const googleLinkSchema = z.object({ grantId: identityFlowIdSchema, idToken: z.string().min(1) }).strict();
export const totpConfirmSchema = z
  .object({ enrollmentId: identityFlowIdSchema, code: z.string().regex(/^\d{6}$/) })
  .strict()
  .meta({ id: 'TotpConfirm' });
export const approvalCreateSchema = z.object({ accountId: z.string().min(1) }).strict();
export const approvalIdSchema = z.object({ requestId: z.string().uuid() }).strict();
export const approvalConsumeSchema = z
  .object({ requestId: z.string().uuid(), userCode: z.string().regex(/^\d{6}$/) })
  .strict();
export const securityIdentityPathSchema = z.object({ identityId: z.string().min(1) }).strict();
export const securityDevicePathSchema = z.object({ deviceId: z.string().min(1) }).strict();

export const restrictedSessionSchema = z
  .object({
    kind: z.literal('restricted'),
    authenticated: z.literal(false),
    expiresAt: z.string(),
    user: z.null(),
    verifiedEmail: emailSchema,
  })
  .meta({ id: 'AuthRestrictedSession' });

export const sessionResponseSchema = z
  .discriminatedUnion('kind', [
    z.object({ authenticated: z.literal(false), kind: z.literal('anonymous'), user: z.null() }),
    restrictedSessionSchema,
    z.object({ authenticated: z.literal(true), kind: z.literal('full'), user: authUserSchema }),
  ])
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

export const fullSessionSchema = z
  .object({
    authenticated: z.literal(true),
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
  '/auth/identity/start': {
    post: { responses: { 201: { description: 'Identity flow created.' } } },
  },
  '/auth/identity/identify': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: identityIdentifySchema } } },
      responses: { 202: { description: 'Identity verification requested.' } },
    },
  },
  '/auth/identity/status': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: identityStatusSchema } } },
      responses: { 200: { description: 'Identity flow status.' } },
    },
  },
  '/auth/identity/recovery/verify': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: recoveryVerifySchema } } },
      responses: { 200: { description: 'Recovery verified.' } },
    },
  },
  '/auth/google/complete': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: googleCompleteSchema } } },
      responses: { 200: { description: 'Google authentication complete.' } },
    },
  },
  '/auth/password/sign-in': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: passwordSignInSchema } } },
      responses: {
        202: { description: 'Password accepted; server-selected second factor required.' },
        404: { description: 'Password authentication is disabled.' },
        503: { description: 'Password authentication prerequisites are unavailable.' },
      },
    },
  },
  '/auth/password/sign-up': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: passwordSignUpSchema } } },
      responses: {
        202: {
          content: {
            'application/json': { schema: responseEnvelope(passwordSignUpResponseSchema, 'PasswordSignUpEnvelope') },
          },
          description: 'Signup started; verify the email address.',
        },
      },
    },
  },
  '/auth/password/sign-up/verify': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: passwordSignUpVerifySchema } } },
      responses: { 200: { description: 'Signup email verified; no full session is created.' } },
    },
  },
  '/auth/password/reset/request': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: passwordResetRequestSchema } } },
      responses: {
        202: {
          content: {
            'application/json': {
              schema: responseEnvelope(passwordResetRequestResponseSchema, 'PasswordResetRequestEnvelope'),
            },
          },
          description: 'If eligible, a password reset code was sent.',
        },
      },
    },
  },
  '/auth/password/reset/complete': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: passwordResetCompleteSchema } } },
      responses: {
        200: {
          content: {
            'application/json': { schema: responseEnvelope(passwordResetResponseSchema, 'PasswordResetEnvelope') },
          },
          description: 'Password reset completed.',
        },
      },
    },
  },
  '/auth/password/verify': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: passwordVerifySchema } } },
      responses: { 200: { description: 'Password second factor verified.' } },
    },
  },
  '/auth/password/resend': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: passwordResendSchema } } },
      responses: { 202: { description: 'Password second-factor code resent.' } },
    },
  },
  '/auth/password/set': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: passwordSetSchema } } },
      responses: {
        200: {
          content: {
            'application/json': { schema: responseEnvelope(passwordSetResponseSchema, 'PasswordSetEnvelope') },
          },
          description: 'Password set successfully.',
        },
      },
    },
  },
  '/auth/password/change': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: passwordChangeSchema } } },
      responses: { 200: { description: 'Password changed.' } },
    },
  },
  '/auth/password/remove': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: passwordRemoveSchema } } },
      responses: { 204: { description: 'Password removed.' } },
    },
  },
  '/auth/reauth/start': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: reauthStartSchema } } },
      responses: { 201: { description: 'Reauthentication started.' } },
    },
  },
  '/auth/reauth/complete': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: reauthCompleteSchema } } },
      responses: { 200: { description: 'Reauthentication completed.' } },
    },
  },
  '/auth/recovery-codes/regenerate': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: operationGrantSchema } } },
      responses: { 200: { description: 'Recovery codes regenerated.' } },
    },
  },
  '/auth/google/link': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: googleLinkSchema } } },
      responses: { 200: { description: 'Google identity linked.' } },
    },
  },
  '/auth/totp/setup': {
    post: {
      responses: {
        201: { description: 'TOTP enrollment started.' },
        404: { description: 'TOTP enrollment disabled.' },
      },
    },
  },
  '/auth/totp/confirm': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: totpConfirmSchema } } },
      responses: { 200: { description: 'TOTP enrollment confirmed.' } },
    },
  },
  '/auth/totp/disable': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: operationGrantSchema } } },
      responses: { 204: { description: 'TOTP disabled.' } },
    },
  },
  '/auth/device-approval/request': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: approvalCreateSchema } } },
      responses: { 201: { description: 'Approval request created.' } },
    },
  },
  '/auth/device-approval/status': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: approvalIdSchema } } },
      responses: { 200: { description: 'Approval request status.' } },
    },
  },
  '/auth/device-approval/consume': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: approvalConsumeSchema } } },
      responses: { 200: { description: 'Approval grant consumed.' } },
    },
  },
  '/auth/device-approval/approve': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: approvalIdSchema } } },
      responses: { 200: { description: 'Device approval accepted.' } },
    },
  },
  '/auth/security/overview': {
    get: { responses: { 200: { description: 'Security settings and recent security events.' } } },
  },
  '/auth/security/federated/{identityId}': {
    delete: { responses: { 204: { description: 'Federated identity revoked.' } } },
  },
  '/auth/security/devices/{deviceId}': { delete: { responses: { 204: { description: 'Trusted device revoked.' } } } },
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
  '/auth/restricted/accounts': {
    get: {
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(
                z
                  .object({
                    accounts: z.array(
                      z
                        .object({ accountId: z.string(), name: z.string(), role: z.string(), selected: z.boolean() })
                        .strict(),
                    ),
                  })
                  .strict(),
                'RestrictedAccountChoicesEnvelope',
              ),
            },
          },
          description: 'Accounts eligible for the verified email.',
        },
      },
    },
  },
  '/auth/restricted/accounts/select': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: restrictedAccountSelectSchema } } },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(restrictedAccountChoiceSchema, 'RestrictedAccountSelectionEnvelope'),
            },
          },
          description: 'Restricted session bound to the selected account.',
        },
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
