import { challengeIdSchema, emailSchema, pinSchema, z } from '../shared/http/route-schemas';

import { normalizePassword, validatePasswordPolicy } from './password';

export const authUserSchema = z
  .object({
    accountId: z
      .string()
      .meta({ description: 'Active account identifier.', example: 'account-123', id: 'AuthAccountId' }),
    email: emailSchema,
    emailVerifiedAt: z
      .string()
      .nullable()
      .meta({ description: 'Verification timestamp.', example: '2026-01-01T00:00:00.000Z', id: 'AuthEmailVerifiedAt' }),
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
    'email_change',
  ]),
});
export type VerificationPurpose = z.infer<typeof challengeSchema>['purpose'];

export const emailOtpRequestSchema = z.object({ email: emailSchema }).meta({ id: 'EmailOtpRequest' });
export const emailOtpVerifySchema = z
  .object({ flowId: challengeIdSchema, pin: pinSchema })
  .meta({ id: 'EmailOtpVerify' });
export const emailOtpResendSchema = z.object({ flowId: challengeIdSchema }).meta({ id: 'EmailOtpResend' });
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
export const recoveryVerifySchema = z
  .object({
    flowId: identityFlowIdSchema,
    pin: pinSchema,
    factor: z
      .object({ kind: z.enum(['totp', 'recovery_code']), code: z.string().min(1).max(128) })
      .strict()
      .optional(),
  })
  .strict();
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
      .refine(validatePasswordPolicy, 'Password must be between 12 and 128 characters.'),
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
      'google_unlink',
      'email_change',
      'workspace_leave',
      'sessions_revoke',
      'passkey_enroll',
      'vault_unlock_manage',
      'vault_recovery_export',
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
export const reauthStartResponseSchema = z
  .object({
    grantId: identityFlowIdSchema,
    methods: z.array(z.enum(['passkey', 'google', 'password', 'totp', 'recovery_code'])),
    google: z.object({ clientId: z.string(), nonce: z.string() }).strict().optional(),
    expiresAt: z.string(),
    passwordRequiresTotp: z.boolean(),
  })
  .strict();
export const securityOverviewSchema = z
  .object({
    passwordEnabled: z.boolean(),
    googleLinkEnabled: z.boolean(),
    totpEnabled: z.boolean(),
    recoveryCodesRemaining: z.number().int().nonnegative(),
    passkeys: z.array(
      z.object({ id: z.string(), label: z.string(), createdAt: z.string(), lastUsedAt: z.string().nullable() }),
    ),
    federatedIdentities: z.array(
      z.object({
        id: z.string(),
        provider: z.string(),
        emailAtLink: z.string(),
        linkedAt: z.string(),
        lastUsedAt: z.string().nullable(),
      }),
    ),
    trustedDevices: z.array(
      z.object({ id: z.string(), createdAt: z.string(), lastUsedAt: z.string().nullable(), expiresAt: z.string() }),
    ),
    recoveryEvents: z.array(z.object({ event: z.string(), outcome: z.string(), createdAt: z.string() })),
  })
  .strict();
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
export const approvalStatusSchema = z.enum(['pending', 'approved', 'denied', 'cancelled', 'consumed', 'expired']);
export const approvalReviewSchema = z
  .object({
    requestId: z.string().uuid(),
    status: approvalStatusSchema,
    accountId: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
    requester: z.boolean(),
  })
  .strict();
export const approvalTerminalSchema = z
  .object({ requestId: z.string().uuid(), status: z.enum(['denied', 'cancelled']) })
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
  .object({ authenticated: z.literal(true), user: authUserSchema })
  .meta({ id: 'AuthenticatedResponse' });
export const messageResponseSchema = z.object({ message: z.string() }).meta({ id: 'MessageResponse' });
export const fullSessionSchema = z
  .object({ authenticated: z.literal(true), kind: z.literal('full'), user: authUserSchema })
  .meta({ id: 'AuthFullSession' });
export const sessionUpgradeSchema = z
  .union([restrictedSessionSchema, fullSessionSchema])
  .meta({ id: 'AuthSessionUpgrade' });
