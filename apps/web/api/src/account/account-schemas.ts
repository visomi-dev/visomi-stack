import type { z as Zod } from 'zod';

import { errorResponses, responseEnvelope, z } from '../shared/http/route-schemas';

export const preferencesSchema = z
  .object({ locale: z.enum(['en', 'es']), theme: z.enum(['system', 'light', 'dark']) })
  .strict();
export const profileUpdateSchema = z
  .object({ displayName: z.string().trim().max(100), preferences: preferencesSchema })
  .strict();
export type ProfileUpdate = Zod.infer<typeof profileUpdateSchema>;
export const emailChangeSchema = z
  .object({
    grantId: z.string().min(1),
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
  })
  .strict();
export const emailVerifySchema = z.object({ flowId: z.uuid(), pin: z.string().regex(/^\d{6}$/) }).strict();
export const leaveWorkspaceSchema = z.object({ grantId: z.string().min(1) }).strict();
export const transferOwnershipSchema = z
  .object({ grantId: z.string().min(1), targetUserId: z.string().min(1).max(128) })
  .strict();

const profileSchema = z.object({
  id: z.string(),
  email: z.email(),
  emailVerifiedAt: z.iso.datetime().nullable(),
  displayName: z.string(),
  preferences: preferencesSchema,
  preferencesConfigured: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const membershipsSchema = z.array(
  z.object({ accountId: z.string(), name: z.string(), role: z.string(), joinedAt: z.iso.datetime() }),
);
const resultSchema = z.object({
  changed: z.literal(true),
  signInRequired: z.literal(true),
  notification: z.enum(['sent', 'failed']),
});

function responses(schema: Zod.ZodType, name: string) {
  return {
    ...errorResponses,
    200: { description: name, content: { 'application/json': { schema: responseEnvelope(schema, name) } } },
  };
}
function body(schema: Zod.ZodType) {
  return { required: true, content: { 'application/json': { schema } } };
}

export const accountPaths = {
  '/account/profile': {
    get: {
      responses: responses(
        z.object({
          profile: profileSchema,
          memberships: membershipsSchema,
          selectedAccountId: z.string(),
          isWorkspaceOwner: z.boolean(),
          ownershipCandidates: z.array(z.object({ userId: z.string(), displayName: z.string(), email: z.email() })),
        }),
        'AccountProfileEnvelope',
      ),
    },
    patch: { requestBody: body(profileUpdateSchema), responses: responses(profileSchema, 'UpdatedProfileEnvelope') },
  },
  '/account/export': {
    get: {
      description: 'Profile and membership metadata only. No credentials, sessions, documents or client keys.',
      responses: responses(
        z.object({
          schemaVersion: z.literal(1),
          scope: z.literal('profile_and_membership_metadata'),
          exportedAt: z.iso.datetime(),
          profile: profileSchema,
          memberships: membershipsSchema,
        }),
        'ProfileMetadataExportEnvelope',
      ),
    },
  },
  '/account/email/request': {
    post: {
      requestBody: body(emailChangeSchema),
      responses: responses(
        z.object({ flowId: z.uuid(), email: z.email(), expiresAt: z.iso.datetime() }),
        'EmailChangeChallengeEnvelope',
      ),
    },
  },
  '/account/email/verify': {
    post: { requestBody: body(emailVerifySchema), responses: responses(resultSchema, 'EmailChangeCompletedEnvelope') },
  },
  '/account/workspace/transfer': {
    post: {
      requestBody: body(transferOwnershipSchema),
      responses: responses(z.object({ transferred: z.literal(true) }), 'OwnershipTransferredEnvelope'),
    },
  },
  '/account/workspace/leave': {
    post: {
      requestBody: body(leaveWorkspaceSchema),
      responses: responses(
        z.object({
          left: z.literal(true),
          accountId: z.string(),
          signInRequired: z.literal(true),
          hasRemainingMemberships: z.boolean(),
        }),
        'WorkspaceLeftEnvelope',
      ),
    },
  },
};
