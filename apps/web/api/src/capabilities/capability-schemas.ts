import { responseEnvelope, z } from '../shared/http/route-schemas';

const capability = z.enum(['vault-access', 'unlock', 'projection', 'bridge', 'sync', 'recovery', 'offline']);
const clientProfile = z.enum(['web-local-agent', 'web-webcrypto']);
const clientMode = z.enum(['local-agent', 'webcrypto']);

const capabilityClaimSchema = z
  .object({
    format: z.literal('themis.client-capability'),
    version: z.literal(1),
    claimId: z.string().min(1).max(200),
    clientId: z.string().min(1).max(200),
    clientProfile,
    accountId: z.string().min(1).max(200),
    workspaceId: z.string().min(1).max(200),
    capabilities: z.array(capability).min(1).max(20),
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    authenticator: z
      .object({
        scheme: z.enum(['web-session', 'local-agent-signature']),
        keyId: z.string().min(1).max(200),
        proof: z.string().min(1).max(4096),
      })
      .strict(),
  })
  .strict()
  .meta({ id: 'ClientCapabilityClaim' });

const capabilityParamsSchema = z
  .object({ workspaceId: z.string().min(1).max(200) })
  .strict()
  .meta({ id: 'CapabilityParams' });

const modeNegotiationRequestSchema = z
  .object({
    format: z.literal('themis.mode-negotiation-request'),
    requestId: z.string().min(1).max(200),
    clientId: z.string().min(1).max(200),
    clientProfile,
    supportedModes: z.array(clientMode).min(1).max(2),
    supportedVersions: z.array(z.number().int().positive()).min(1).max(10),
    requestedCapabilities: z.array(capability).min(1).max(20),
    preferredMode: clientMode,
    allowDowngrade: z.boolean(),
    claim: capabilityClaimSchema,
  })
  .strict()
  .meta({ id: 'ModeNegotiationRequest' });

// Keep the request body explicitly object-shaped in the published document.
// Runtime validation remains owned by modeNegotiationRequestSchema above.
const modeNegotiationRequestOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'format',
    'requestId',
    'clientId',
    'clientProfile',
    'supportedModes',
    'supportedVersions',
    'requestedCapabilities',
    'preferredMode',
    'allowDowngrade',
    'claim',
  ] as string[],
  properties: {
    format: { type: 'string', const: 'themis.mode-negotiation-request' },
    requestId: { type: 'string', minLength: 1, maxLength: 200 },
    clientId: { type: 'string', minLength: 1, maxLength: 200 },
    clientProfile: { type: 'string', enum: ['web-local-agent', 'web-webcrypto'] as string[] },
    supportedModes: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: { type: 'string', enum: ['local-agent', 'webcrypto'] as string[] },
    },
    supportedVersions: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'integer', minimum: 1 } },
    requestedCapabilities: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'string',
        enum: ['vault-access', 'unlock', 'projection', 'bridge', 'sync', 'recovery', 'offline'] as string[],
      },
    },
    preferredMode: { type: 'string', enum: ['local-agent', 'webcrypto'] as string[] },
    allowDowngrade: { type: 'boolean' },
    claim: {
      type: 'object',
      additionalProperties: false,
      required: [
        'format',
        'version',
        'claimId',
        'clientId',
        'clientProfile',
        'accountId',
        'workspaceId',
        'capabilities',
        'issuedAt',
        'expiresAt',
        'authenticator',
      ] as string[],
      properties: {
        format: { type: 'string', const: 'themis.client-capability' },
        version: { type: 'integer', const: 1 },
        claimId: { type: 'string', minLength: 1, maxLength: 200 },
        clientId: { type: 'string', minLength: 1, maxLength: 200 },
        clientProfile: { type: 'string', enum: ['web-local-agent', 'web-webcrypto'] as string[] },
        accountId: { type: 'string', minLength: 1, maxLength: 200 },
        workspaceId: { type: 'string', minLength: 1, maxLength: 200 },
        capabilities: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'string',
            enum: ['vault-access', 'unlock', 'projection', 'bridge', 'sync', 'recovery', 'offline'] as string[],
          },
        },
        issuedAt: { type: 'string', format: 'date-time' },
        expiresAt: { type: 'string', format: 'date-time' },
        authenticator: {
          type: 'object',
          additionalProperties: false,
          required: ['scheme', 'keyId', 'proof'] as string[],
          properties: {
            scheme: { type: 'string', enum: ['web-session', 'local-agent-signature'] as string[] },
            keyId: { type: 'string', minLength: 1, maxLength: 200 },
            proof: { type: 'string', minLength: 1, maxLength: 4096 },
          },
        },
      },
    },
  },
} as const;

const capabilityProfileSchema = z
  .object({
    profile: clientProfile,
    modes: z.array(clientMode),
    capabilities: z
      .object({
        'local-agent': z.array(capability).optional(),
        webcrypto: z.array(capability),
      })
      .strict(),
  })
  .strict();

const discoveryResponseSchema = z
  .object({
    version: z.literal(1),
    profiles: z.array(capabilityProfileSchema),
  })
  .strict()
  .meta({ id: 'CapabilityDiscoveryResponse' });

const modeNegotiationResponseSchema = z
  .object({
    format: z.literal('themis.mode-negotiation-response'),
    requestId: z.string(),
    version: z.literal(1),
    clientProfile,
    selectedMode: clientMode,
    grantedCapabilities: z.array(capability),
    state: z.literal('ready'),
  })
  .strict()
  .meta({ id: 'ModeNegotiationResponse' });

const capabilityOpenApiPaths = {
  '/capabilities/{workspaceId}': {
    get: {
      requestParams: { path: capabilityParamsSchema },
      responses: {
        200: {
          content: {
            'application/json': { schema: responseEnvelope(discoveryResponseSchema, 'CapabilityDiscoveryEnvelope') },
          },
          description: 'Supported dual-client capability profiles.',
        },
      },
    },
    post: {
      requestParams: { path: capabilityParamsSchema },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: modeNegotiationRequestOpenApiSchema } },
      },
      responses: {
        200: {
          content: {
            'application/json': { schema: responseEnvelope(modeNegotiationResponseSchema, 'ModeNegotiationEnvelope') },
          },
          description: 'Negotiated client mode and capabilities.',
        },
      },
    },
  },
};

export {
  capabilityOpenApiPaths,
  capabilityParamsSchema,
  capabilityClaimSchema,
  discoveryResponseSchema,
  modeNegotiationRequestSchema,
  modeNegotiationResponseSchema,
};
