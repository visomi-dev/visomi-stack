import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { defineRoute } from '@visomi-stack/web-backend-shared';
import { z } from 'zod';

import { emailSchema } from '../email/schema';
import {
  commonErrors,
  cookieSecurity,
  csrfSecurity,
  emptyBody,
  expirySchema,
  identifierSchema,
  identityParams,
  mutationDescription,
  sessionSchema,
  validationErrors,
} from '../shared/contracts';

const labelSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => value.trim().length > 0)
  .transform((value) => value.trim());
// This envelope check preserves WebAuthn fields/extensions. SimpleWebAuthn remains
// responsible for the complete cryptographic credential/assertion verification.
const credentialFields = {
  id: z.string(),
  rawId: z.string(),
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.looseObject({
    appid: z.boolean().optional(),
    credProps: z.looseObject({ rk: z.boolean().optional() }).optional(),
    hmacCreateSecret: z.boolean().optional(),
  }),
};
const registrationResponseSchema = z.looseObject({
  ...credentialFields,
  response: z.looseObject({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
    authenticatorData: z.string().optional(),
    transports: z.array(z.string()).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: z.string().optional(),
  }),
}) satisfies z.ZodType<RegistrationResponseJSON>;
const authenticationResponseSchema = z.looseObject({
  ...credentialFields,
  response: z.looseObject({
    clientDataJSON: z.string(),
    authenticatorData: z.string(),
    signature: z.string(),
    userHandle: z.string().optional(),
  }),
}) satisfies z.ZodType<AuthenticationResponseJSON>;
const authenticationOptionsSchema = z.looseObject({
  challenge: z.string(),
  rpId: z.string().optional(),
  timeout: z.number().optional(),
  userVerification: z.string().optional(),
  allowCredentials: z.array(z.looseObject({ id: z.string(), type: z.literal('public-key') })).optional(),
});
const registrationOptionsSchema = z.looseObject({
  challenge: z.string(),
  rp: z.object({ id: z.string().optional(), name: z.string() }),
  user: z.object({ id: z.string(), name: z.string(), displayName: z.string() }),
  pubKeyCredParams: z.array(z.object({ type: z.literal('public-key'), alg: z.number() })),
});
const credentialSchema = z.object({
  id: identifierSchema,
  label: z.string(),
  createdAt: expirySchema,
  lastUsedAt: expirySchema.nullable(),
  backupEligible: z.boolean(),
  backupState: z.boolean(),
});

export const passkeysContracts = {
  registrationOptions: defineRoute({
    validationErrors,
    method: 'post',
    path: '/passkeys/registration/options',
    operationId: 'passkeys_registrationOptions',
    summary: 'Start passkey registration',
    tags: ['passkeys'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.union([z.strictObject({ email: emailSchema }), emptyBody]) }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Three-minute registration ceremony; anonymous signup requires email.',
        content: {
          'application/json': {
            schema: z.object({ challengeId: identifierSchema, options: registrationOptionsSchema }),
          },
        },
      },
    },
  }),
  registerPasskey: defineRoute({
    validationErrors,
    method: 'post',
    path: '/passkeys/registration/verify',
    operationId: 'passkeys_registerPasskey',
    summary: 'Verify passkey registration',
    tags: ['passkeys'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({
      body: z.strictObject({
        challengeId: identifierSchema,
        response: registrationResponseSchema,
        label: labelSchema.optional(),
      }),
    }),
    responses: {
      ...commonErrors,
      201: {
        description: 'Unverified signup or enrolled passkey. Signup includes an email proof.',
        content: {
          'application/json': {
            schema: sessionSchema.extend({ flowId: identifierSchema.optional(), expiresAt: expirySchema.optional() }),
          },
        },
      },
    },
  }),
  authenticationOptions: defineRoute({
    validationErrors,
    method: 'post',
    path: '/passkeys/authentication/options',
    operationId: 'passkeys_authenticationOptions',
    summary: 'Start passkey authentication',
    tags: ['passkeys'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: emptyBody }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Three-minute discoverable authentication ceremony.',
        content: {
          'application/json': {
            schema: z.object({ challengeId: identifierSchema, options: authenticationOptionsSchema }),
          },
        },
      },
    },
  }),
  authenticatePasskey: defineRoute({
    validationErrors,
    method: 'post',
    path: '/passkeys/authentication/verify',
    operationId: 'passkeys_authenticatePasskey',
    summary: 'Verify passkey authentication',
    tags: ['passkeys'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({
      body: z.strictObject({ challengeId: identifierSchema, response: authenticationResponseSchema }),
    }),
    responses: {
      ...commonErrors,
      200: {
        description: 'Cryptographically verified passkey session. An unverified email still limits access.',
        content: { 'application/json': { schema: sessionSchema } },
      },
    },
  }),
  listPasskeys: defineRoute({
    validationErrors,
    method: 'get',
    path: '/passkeys',
    operationId: 'passkeys_listPasskeys',
    summary: 'List passkeys',
    tags: ['passkeys'],
    description: 'Requires a full verified session where documented; recent proof is required for management changes.',
    security: cookieSecurity,
    request: z.object({}),
    responses: {
      ...commonErrors,
      200: {
        description: 'Owned active credentials in a full verified session.',
        content: { 'application/json': { schema: z.object({ credentials: z.array(credentialSchema) }) } },
      },
    },
  }),
  renamePasskey: defineRoute({
    validationErrors,
    method: 'patch',
    path: '/passkeys/:id',
    operationId: 'passkeys_renamePasskey',
    summary: 'Rename a passkey',
    tags: ['passkeys'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ body: z.strictObject({ label: labelSchema }), params: identityParams }),
    responses: { ...commonErrors, 204: { description: 'Passkey renamed after recent authentication.' } },
  }),
  revokePasskey: defineRoute({
    validationErrors,
    method: 'delete',
    path: '/passkeys/:id',
    operationId: 'passkeys_revokePasskey',
    summary: 'Revoke a passkey',
    tags: ['passkeys'],
    description: mutationDescription,
    security: csrfSecurity,
    request: z.object({ params: identityParams }),
    responses: {
      ...commonErrors,
      204: { description: 'Passkey and affected sessions revoked; a primary method must remain.' },
    },
  }),
};
