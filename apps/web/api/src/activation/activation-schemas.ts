import { apiKeyIdParamSchema, responseEnvelope, z } from '../shared/http/route-schemas';

export const activationMilestoneSchema = z.enum([
  'activation_completed',
  'activation_skipped',
  'api_key_created',
  'config_copied',
  'seed_prompt_copied',
]);

export const metadataSchema = z.record(z.string(), z.string().nullable());

export const activationStateSchema = z
  .object({
    apiKeys: z.array(
      z.object({
        createdAt: z.string(),
        id: z.string(),
        label: z.string(),
        lastUsedAt: z.string().nullable(),
        revokedAt: z.string().nullable(),
        tokenPrefix: z.string(),
      }),
    ),
    milestones: z.array(activationMilestoneSchema),
    seedPrompt: z.string(),
  })
  .meta({ id: 'ActivationState' });

export const createApiKeySchema = z
  .object({
    label: z.string().min(1).max(80).meta({ description: 'API key label.', example: 'Primary workspace key' }),
  })
  .meta({ id: 'CreateApiKeyRequest' });

export const createdApiKeySchema = z
  .object({
    createdAt: z.string(),
    id: z.string(),
    label: z.string(),
    lastUsedAt: z.string().nullable(),
    plaintextToken: z.string(),
    revokedAt: z.string().nullable(),
    tokenPrefix: z.string(),
  })
  .meta({ id: 'CreatedApiKey' });

export const milestoneBodySchema = z
  .object({
    metadata: metadataSchema.optional(),
    milestone: activationMilestoneSchema,
  })
  .meta({ id: 'ActivationMilestoneRequest' });

export const apiKeyParamsSchema = z.object({ apiKeyId: apiKeyIdParamSchema });

export const activationOpenApiPaths = {
  '/activation': {
    get: {
      responses: {
        200: {
          content: {
            'application/json': { schema: responseEnvelope(activationStateSchema, 'ActivationStateEnvelope') },
          },
          description: 'Activation state.',
        },
      },
    },
  },
  '/activation/api-keys': {
    post: {
      requestBody: { content: { 'application/json': { schema: createApiKeySchema } } },
      responses: {
        201: {
          content: { 'application/json': { schema: responseEnvelope(createdApiKeySchema, 'CreatedApiKeyEnvelope') } },
          description: 'API key created.',
        },
      },
    },
  },
  '/activation/milestones': {
    post: {
      requestBody: { content: { 'application/json': { schema: milestoneBodySchema } } },
      responses: { 204: { description: 'Milestone recorded.' } },
    },
  },
  '/activation/api-keys/{apiKeyId}/revoke': {
    post: {
      requestParams: { path: apiKeyParamsSchema },
      responses: { 204: { description: 'API key revoked.' } },
    },
  },
};

export type ActivationMilestone = z.infer<typeof activationMilestoneSchema>;
export type ActivationState = z.infer<typeof activationStateSchema>;
export type CreateApiKey = z.infer<typeof createApiKeySchema>;
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;
export type ActivationApiKey = z.infer<typeof activationStateSchema>['apiKeys'][number];
