import { z } from 'zod';

const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const days = z.number().int().min(0).max(36_500);
const positiveInteger = z.number().int().min(1).max(2_147_483_647);

export const authorizationPolicySchema = z.strictObject({
  identity: z.literal('verified-cloud-session'),
  default: z.literal('deny'),
  scope: z.enum(['tenant', 'group', 'resource']),
  recordRules: z.enum(['inherit', 'domain-required']),
});

export const visibleMetadataSchema = z.enum([
  'tenant-id',
  'group-id',
  'resource-id',
  'object-id',
  'revision',
  'generation',
  'schema-version',
  'ciphertext-bytes',
  'timestamp',
  'tombstone',
  'device-id',
  'recipient-id',
  'checkpoint',
  'public-key',
  'enrollment-challenge',
  'operation-id',
  'authorization-epoch',
  'unit-kind',
]);

const domainFields = {
  domain: identifier,
  classification: z.enum(['public', 'internal', 'confidential', 'restricted']),
  location: z.enum(['local', 'cloud', 'synchronized']),
  authorization: authorizationPolicySchema,
  visibleMetadata: z.array(visibleMetadataSchema).max(visibleMetadataSchema.options.length),
  retention: z.strictObject({
    activeDays: positiveInteger.nullable(),
    deletionGraceDays: days,
    cloudBackupDays: days,
    tombstoneDays: days,
    offlineWindowDays: days,
  }),
  quotas: z.strictObject({
    maxUnitBytes: positiveInteger,
    maxScopeBytes: positiveInteger,
    maxUnits: positiveInteger,
  }),
};

const serverCapabilities = z.strictObject({
  search: z.boolean(),
  analytics: z.boolean(),
  ai: z.boolean(),
  jobs: z.boolean(),
});
const noServerProcessing = z.strictObject({
  search: z.literal(false),
  analytics: z.literal(false),
  ai: z.literal(false),
  jobs: z.literal(false),
});

export const domainPolicySchema = z
  .discriminatedUnion('readers', [
    z.strictObject({
      ...domainFields,
      readers: z.literal('server-authorized'),
      location: z.literal('cloud'),
      keyScope: z.literal('none'),
      recovery: z.literal('server-managed'),
      serverProcessing: serverCapabilities,
    }),
    z.strictObject({
      ...domainFields,
      readers: z.literal('client-keys-only'),
      keyScope: z.enum(['tenant', 'group', 'resource']),
      recovery: z.enum(['none', 'user-held-recovery-key']),
      serverProcessing: noServerProcessing,
    }),
  ])
  .superRefine((policy, context) => {
    const reject = () => context.addIssue({ code: 'custom', message: 'persistence_policy_invalid' });

    if (new Set(policy.visibleMetadata).size !== policy.visibleMetadata.length) {
      reject();
    }

    if (policy.quotas.maxUnitBytes > policy.quotas.maxScopeBytes) {
      reject();
    }

    if (policy.location === 'local' && (policy.visibleMetadata.length || policy.retention.cloudBackupDays !== 0)) {
      reject();
    }

    if (policy.location !== 'local' && !policy.visibleMetadata.includes('tenant-id')) {
      reject();
    }

    if (policy.location === 'synchronized' && policy.retention.tombstoneDays < policy.retention.offlineWindowDays) {
      reject();
    }

    if (policy.location === 'synchronized') {
      const required = ['tenant-id', 'object-id', 'revision', 'generation', 'tombstone', 'checkpoint'] as const;

      if (required.some((field) => !policy.visibleMetadata.includes(field))) {
        reject();
      }
    }

    if (policy.location !== 'local' && policy.authorization.scope !== 'tenant') {
      const scopeMetadata = policy.authorization.scope === 'group' ? 'group-id' : 'resource-id';

      if (!policy.visibleMetadata.includes(scopeMetadata)) {
        reject();
      }
    }

    if (policy.readers === 'client-keys-only' && policy.location !== 'local') {
      const scopeMetadata =
        policy.keyScope === 'tenant' ? 'tenant-id' : policy.keyScope === 'group' ? 'group-id' : 'resource-id';

      if (!policy.visibleMetadata.includes(scopeMetadata)) {
        reject();
      }
    }
  });

export const productPolicySchema = z
  .strictObject({
    version: z.literal(1),
    product: identifier,
    mode: z.enum(['saas', 'zk', 'hybrid']),
    identity: z.strictObject({ location: z.literal('cloud'), readers: z.literal('server-authorized') }),
    domains: z.array(domainPolicySchema).min(1).max(64),
  })
  .superRefine((policy, context) => {
    const names = policy.domains.map((domain) => domain.domain);
    const hasServer = policy.domains.some((domain) => domain.readers === 'server-authorized');
    const hasClient = policy.domains.some((domain) => domain.readers === 'client-keys-only');
    const mode = hasServer && hasClient ? 'hybrid' : hasServer ? 'saas' : 'zk';

    if (names.includes('identity') || new Set(names).size !== names.length || mode !== policy.mode) {
      context.addIssue({ code: 'custom', message: 'persistence_policy_invalid' });
    }
  });

export type AuthorizationPolicy = z.infer<typeof authorizationPolicySchema>;
export type DomainPolicy = z.infer<typeof domainPolicySchema>;
export type ProductPolicy = z.infer<typeof productPolicySchema>;
export type VisibleMetadata = z.infer<typeof visibleMetadataSchema>;
export type PersistenceAction = 'read' | 'write' | 'share' | 'delete';

/** Configuration validation only: this does not grant access or select an adapter. */
export function parseProductPolicy(input: unknown): ProductPolicy {
  const result = productPolicySchema.safeParse(input);

  if (!result.success) {
    throw new Error('persistence_policy_invalid');
  }

  return result.data;
}
