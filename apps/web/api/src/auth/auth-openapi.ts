import { challengeIdSchema, responseEnvelope, z } from '../shared/http/route-schemas';

import {
  approvalConsumeSchema,
  approvalCreateSchema,
  approvalIdSchema,
  approvalReviewSchema,
  approvalTerminalSchema,
  emailOtpRequestSchema,
  emailOtpResendSchema,
  emailOtpVerifySchema,
  fullSessionSchema,
  googleCompleteSchema,
  googleLinkSchema,
  identityIdentifySchema,
  identityStatusSchema,
  operationGrantSchema,
  passwordChangeSchema,
  passwordRemoveSchema,
  passwordResendSchema,
  passwordResetCompleteSchema,
  passwordResetRequestResponseSchema,
  passwordResetRequestSchema,
  passwordResetResponseSchema,
  passwordSetResponseSchema,
  passwordSetSchema,
  passwordSignInSchema,
  passwordSignUpResponseSchema,
  passwordSignUpSchema,
  passwordSignUpVerifySchema,
  passwordVerifySchema,
  reauthCompleteSchema,
  reauthStartResponseSchema,
  reauthStartSchema,
  recoveryVerifySchema,
  restrictedAccountChoiceSchema,
  restrictedAccountSelectSchema,
  securityOverviewSchema,
  sessionResponseSchema,
  sessionUpgradeSchema,
  totpConfirmSchema,
} from './auth-schemas';

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
      responses: {
        200: {
          content: {
            'application/json': { schema: responseEnvelope(fullSessionSchema, 'PasswordSignUpVerifiedEnvelope') },
          },
          description: 'Signup email verified and full session created.',
        },
      },
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
  '/auth/passkey/enrollment/identity': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: operationGrantSchema } } },
      responses: { 200: { description: 'Verified identity authorizes passkey enrollment.' } },
    },
  },
  '/auth/passkey/enrollment/start': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: passwordRemoveSchema } } },
      responses: { 202: { description: 'Password proof accepted; verify the server-selected factor.' } },
    },
  },
  '/auth/passkey/enrollment/complete': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: passwordVerifySchema } } },
      responses: { 200: { description: 'Session-bound first-passkey enrollment authorized.' } },
    },
  },
  '/auth/reauth/start': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: reauthStartSchema } } },
      responses: {
        201: {
          description: 'Reauthentication started.',
          content: {
            'application/json': {
              schema: responseEnvelope(reauthStartResponseSchema, 'ReauthenticationStartEnvelope'),
            },
          },
        },
      },
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
      requestBody: { required: true, content: { 'application/json': { schema: operationGrantSchema } } },
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
  '/auth/device-approval/review': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: approvalIdSchema } } },
      responses: {
        200: {
          description: 'Authorized approval review.',
          content: { 'application/json': { schema: responseEnvelope(approvalReviewSchema, 'ApprovalReviewEnvelope') } },
        },
      },
    },
  },
  '/auth/device-approval/cancel': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: approvalIdSchema } } },
      responses: {
        200: {
          description: 'Requester cancelled approval.',
          content: {
            'application/json': { schema: responseEnvelope(approvalTerminalSchema, 'ApprovalCancelledEnvelope') },
          },
        },
      },
    },
  },
  '/auth/device-approval/deny': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: approvalIdSchema } } },
      responses: {
        200: {
          description: 'Approver denied approval.',
          content: {
            'application/json': { schema: responseEnvelope(approvalTerminalSchema, 'ApprovalDeniedEnvelope') },
          },
        },
      },
    },
  },
  '/auth/device-approval/approve': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: approvalIdSchema } } },
      responses: { 200: { description: 'Device approval accepted.' } },
    },
  },
  '/auth/security/overview': {
    get: {
      responses: {
        200: {
          description: 'Security settings and recent security events.',
          content: {
            'application/json': { schema: responseEnvelope(securityOverviewSchema, 'SecurityOverviewEnvelope') },
          },
        },
      },
    },
  },
  '/auth/security/federated/{identityId}': {
    delete: {
      requestBody: { required: true, content: { 'application/json': { schema: operationGrantSchema } } },
      responses: { 204: { description: 'Federated identity revoked.' } },
    },
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
