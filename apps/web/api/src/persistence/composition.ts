import { developmentPersistencePolicy, parseProductPolicy, type ProductPolicy } from '@visomi-stack/shared-persistence';

/** Current adapters fail composition rather than pretending unsupported server capabilities exist. */
export function validatePersistenceComposition(input: ProductPolicy): ProductPolicy {
  const policy = parseProductPolicy(input);

  for (const domain of policy.domains) {
    if (domain.readers === 'server-authorized') {
      if (domain.serverProcessing.analytics || domain.serverProcessing.ai || domain.serverProcessing.jobs) {
        throw new Error('persistence_adapter_unsupported');
      }
    } else if (domain.location !== 'local') {
      const required = [
        'tenant-id',
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
      ] as const;
      const rank = { tenant: 0, group: 1, resource: 2 };

      if (
        domain.location !== 'synchronized' ||
        domain.retention.activeDays !== null ||
        domain.authorization.recordRules !== 'inherit' ||
        rank[domain.keyScope] > rank[domain.authorization.scope] ||
        required.some((field) => !domain.visibleMetadata.includes(field))
      ) {
        throw new Error('persistence_adapter_unsupported');
      }
    }
  }

  return policy;
}

/** Explicit development composition; never selects a real product's recovery/custody policy. */
export function persistenceExample(environment: Record<string, string | undefined>): ProductPolicy | undefined {
  const policy = developmentPersistencePolicy(environment);

  return policy ? validatePersistenceComposition(policy) : undefined;
}
