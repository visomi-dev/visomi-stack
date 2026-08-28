import { emailSchema, responseEnvelope, z } from '../shared/http/route-schemas';

const credentialResponseSchema = z
  .object({
    id: z.string().min(1).max(1024),
    rawId: z.string().min(1).max(1024),
    response: z.object({
      clientDataJSON: z.string().min(1),
      attestationObject: z.string().min(1),
      transports: z.array(z.enum(['ble', 'hybrid', 'internal', 'nfc', 'usb'])).optional(),
    }),
    type: z.literal('public-key'),
    clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
    authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional(),
  })
  .strict();
const assertionResponseSchema = z
  .object({
    id: z.string().min(1).max(1024),
    rawId: z.string().min(1).max(1024),
    response: z.object({
      clientDataJSON: z.string().min(1),
      authenticatorData: z.string().min(1),
      signature: z.string().min(1),
      userHandle: z.string().nullable().optional(),
    }),
    type: z.literal('public-key'),
    clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
    authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional(),
  })
  .strict();

const passkeyEmailSchema = z
  .object({ email: emailSchema, pinVerified: z.boolean().optional().default(false) })
  .strict();
const registrationBeginSchema = passkeyEmailSchema.extend({ label: z.string().trim().min(1).max(120) }).strict();
const registrationCompleteSchema = z
  .object({ challengeId: z.string().min(1).max(200), response: credentialResponseSchema })
  .strict();
const authenticationBeginSchema = passkeyEmailSchema
  .extend({
    explicitPassword: z.boolean().optional().default(false),
    retryRequested: z.boolean().optional().default(false),
  })
  .strict();
const authenticationCompleteSchema = z
  .object({ challengeId: z.string().min(1).max(200), response: assertionResponseSchema })
  .strict();

const passkeyCredentialSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    transports: z.array(z.string()),
    backupEligible: z.boolean(),
    backupState: z.boolean(),
  })
  .strict()
  .meta({ id: 'PasskeyCredential' });
const passkeyAttemptSchema = z.enum(['passkey_default', 'retry_available', 'password_fallback', 'authenticated']);
const passkeyOptionsSchema = z.record(z.string(), z.unknown());
const authenticatedPasskeySchema = z
  .object({ authenticated: z.literal(true), user: z.record(z.string(), z.unknown()) })
  .strict();
const credentialIdPathSchema = z.object({ credentialId: z.string().min(1).max(1024) }).strict();
const passkeyLabelSchema = z
  .string()
  .refine(
    (value) =>
      [...value].every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;

        return codePoint > 31 && codePoint !== 127;
      }),
    'Use a valid device or security key name.',
  )
  .trim()
  .min(1)
  .max(64)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._'()&/-]*$/u, 'Use a valid device or security key name.');
const credentialRenameSchema = z.object({ label: passkeyLabelSchema }).strict();
const credentialActionSchema = z.object({ action: z.literal('revoke') }).strict();
const credentialMutationSchema = z.union([credentialRenameSchema, credentialActionSchema]);

const passkeyOpenApiPaths = {
  '/auth/passkey/registration/begin': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: registrationBeginSchema } } },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(
                z
                  .object({
                    challengeId: z.string().nullable(),
                    verificationChallengeId: z.string().nullable().optional(),
                    enrollmentId: z.string().nullable().optional(),
                    options: passkeyOptionsSchema.nullable(),
                  })
                  .strict(),
                'PasskeyRegistrationBeginEnvelope',
              ),
            },
          },
          description: 'Registration options.',
        },
      },
    },
  },
  '/auth/passkey/registration/complete': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: registrationCompleteSchema } } },
      responses: {
        201: {
          content: {
            'application/json': {
              schema: responseEnvelope(passkeyCredentialSchema, 'PasskeyRegistrationCompleteEnvelope'),
            },
          },
          description: 'Registered passkey.',
        },
      },
    },
  },
  '/auth/passkey/authentication/begin': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: authenticationBeginSchema } } },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(
                z
                  .object({
                    challengeId: z.string().nullable(),
                    options: passkeyOptionsSchema.nullable(),
                    attempt: passkeyAttemptSchema,
                  })
                  .strict(),
                'PasskeyAuthenticationBeginEnvelope',
              ),
            },
          },
          description: 'Authentication options and fallback signal.',
        },
      },
    },
  },
  '/auth/passkey/authentication/complete': {
    post: {
      requestBody: { required: true, content: { 'application/json': { schema: authenticationCompleteSchema } } },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(authenticatedPasskeySchema, 'PasskeyAuthenticationCompleteEnvelope'),
            },
          },
          description: 'Authenticated session.',
        },
      },
    },
  },
  '/auth/passkey/credentials': {
    get: {
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(
                z.object({ credentials: z.array(passkeyCredentialSchema) }).strict(),
                'PasskeyCredentialListEnvelope',
              ),
            },
          },
          description: 'Passkey list.',
        },
      },
    },
  },
  '/auth/passkey/credentials/{credentialId}': {
    patch: {
      requestParams: { path: credentialIdPathSchema },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: credentialMutationSchema } },
      },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(passkeyCredentialSchema, 'PasskeyCredentialRevokeEnvelope'),
            },
          },
          description: 'Passkey revoked.',
        },
      },
    },
    delete: {
      requestParams: { path: credentialIdPathSchema },
      responses: { 204: { description: 'Passkey deleted.' } },
    },
  },
};

export {
  authenticationBeginSchema,
  authenticationCompleteSchema,
  credentialActionSchema,
  credentialRenameSchema,
  credentialMutationSchema,
  credentialIdPathSchema,
  passkeyOpenApiPaths,
  registrationBeginSchema,
  registrationCompleteSchema,
};
