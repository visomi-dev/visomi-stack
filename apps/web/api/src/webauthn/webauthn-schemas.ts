import { responseEnvelope, z } from '../shared/http/route-schemas';

const webAuthnParamsSchema = z.object({ workspaceId: z.string().min(1).max(200) }).strict();
const credentialParamsSchema = webAuthnParamsSchema.extend({ credentialId: z.string().min(1).max(1024) }).strict();
const recoveryParamsSchema = webAuthnParamsSchema.extend({ recoveryId: z.string().min(1).max(200) }).strict();

const credentialRegistrationSchema = z
  .object({
    credentialId: z.string().min(1).max(1024),
    rpId: z.string().min(1).max(253),
    origin: z.url().max(2048),
    prfSupported: z.boolean(),
    transports: z
      .array(z.enum(['ble', 'hybrid', 'internal', 'nfc', 'usb']))
      .max(5)
      .default([]),
  })
  .strict()
  .meta({ id: 'WebAuthnCredentialRegistration' });

const recoveryRegistrationSchema = z
  .object({ requestId: z.string().min(1).max(200), confirmed: z.literal(true) })
  .strict()
  .meta({ id: 'WebAuthnRecoveryRegistration' });

const recoveryUseSchema = z
  .object({ requestId: z.string().min(1).max(200), confirmed: z.literal(true) })
  .strict()
  .meta({ id: 'WebAuthnRecoveryUse' });

const credentialMetadataSchema = z
  .object({
    credentialId: z.string(),
    rpId: z.string(),
    origin: z.string(),
    prfSupported: z.boolean(),
    transports: z.array(z.string()),
    createdAt: z.string(),
    status: z.enum(['active', 'revoked']),
    revokedAt: z.string().optional(),
  })
  .strict()
  .meta({ id: 'WebAuthnCredentialMetadata' });

const recoveryMetadataSchema = z
  .object({
    recoveryId: z.string(),
    enrolledAt: z.string(),
    status: z.enum(['active', 'used', 'revoked']),
    usedAt: z.string().optional(),
    revokedAt: z.string().optional(),
  })
  .strict()
  .meta({ id: 'WebAuthnRecoveryMetadata' });

const webAuthnOpenApiPaths = {
  '/webauthn/{workspaceId}/credentials': {
    get: {
      requestParams: { path: webAuthnParamsSchema },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(
                z.object({ credentials: z.array(credentialMetadataSchema) }).strict(),
                'WebAuthnCredentialListEnvelope',
              ),
            },
          },
          description: 'Credential metadata retrieved without authenticator secrets.',
        },
      },
    },
    post: {
      requestParams: { path: webAuthnParamsSchema },
      requestBody: { required: true, content: { 'application/json': { schema: credentialRegistrationSchema } } },
      responses: {
        201: {
          content: {
            'application/json': { schema: responseEnvelope(credentialMetadataSchema, 'WebAuthnCredentialEnvelope') },
          },
          description: 'Credential metadata registered.',
        },
      },
    },
  },
  '/webauthn/{workspaceId}/credentials/{credentialId}': {
    delete: {
      requestParams: { path: credentialParamsSchema },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(credentialMetadataSchema, 'WebAuthnCredentialRevocationEnvelope'),
            },
          },
          description: 'Credential metadata revoked.',
        },
      },
    },
  },
  '/webauthn/{workspaceId}/recovery': {
    get: {
      requestParams: { path: webAuthnParamsSchema },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(
                z.object({ recovery: z.array(recoveryMetadataSchema) }).strict(),
                'WebAuthnRecoveryListEnvelope',
              ),
            },
          },
          description: 'Recovery state metadata retrieved without recovery material.',
        },
      },
    },
    post: {
      requestParams: { path: webAuthnParamsSchema },
      requestBody: { required: true, content: { 'application/json': { schema: recoveryRegistrationSchema } } },
      responses: {
        201: {
          content: {
            'application/json': { schema: responseEnvelope(recoveryMetadataSchema, 'WebAuthnRecoveryEnvelope') },
          },
          description: 'Recovery metadata registered; material remains local-only.',
        },
      },
    },
  },
  '/webauthn/{workspaceId}/recovery/{recoveryId}': {
    delete: {
      requestParams: { path: recoveryParamsSchema },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: responseEnvelope(recoveryMetadataSchema, 'WebAuthnRecoveryRevocationEnvelope'),
            },
          },
          description: 'Recovery metadata revoked.',
        },
      },
    },
  },
  '/webauthn/{workspaceId}/recovery/{recoveryId}/use': {
    post: {
      requestParams: { path: recoveryParamsSchema },
      requestBody: { required: true, content: { 'application/json': { schema: recoveryUseSchema } } },
      responses: {
        200: {
          content: {
            'application/json': { schema: responseEnvelope(recoveryMetadataSchema, 'WebAuthnRecoveryUseEnvelope') },
          },
          description: 'Recovery metadata marked used once; no recovery material is accepted.',
        },
      },
    },
  },
};

export {
  credentialMetadataSchema,
  credentialParamsSchema,
  credentialRegistrationSchema,
  recoveryMetadataSchema,
  recoveryParamsSchema,
  recoveryRegistrationSchema,
  recoveryUseSchema,
  webAuthnOpenApiPaths,
  webAuthnParamsSchema,
};
