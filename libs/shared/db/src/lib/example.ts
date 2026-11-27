import { z } from 'zod';

import { parseProductPolicy } from './policy';

export const exampleWorkspaceTargetSchema = z.strictObject({ tenantId: z.uuid(), scopeId: z.uuid() });
export const exampleVaultTargetSchema = exampleWorkspaceTargetSchema.extend({ objectId: z.uuid() });
export const exampleVaultPairingLinkSchema = exampleVaultTargetSchema.extend({ requestId: z.uuid() });
export const exampleVaultPairingListSchema = z.array(exampleVaultPairingLinkSchema).max(32);
export const exampleWorkspacePageSchema = z.strictObject({
  items: z.array(
    exampleWorkspaceTargetSchema.extend({
      createdAt: z.iso.datetime(),
      owner: z.boolean(),
      objectId: z.uuid().nullable().optional(),
      deletingBackup: z.boolean().optional(),
    }),
  ),
  next: z.uuid().nullable(),
});
export const exampleVaultWorkspacePageSchema = exampleWorkspacePageSchema.extend({
  pendingSetup: z.boolean().optional(),
});

/** Synthetic opt-in composition, never a derived product's recovery decision. */
export const syntheticHybridPolicy = parseProductPolicy({
  version: 1,
  product: 'synthetic-example',
  mode: 'hybrid',
  identity: { location: 'cloud', readers: 'server-authorized' },
  domains: [
    {
      domain: 'operations',
      classification: 'internal',
      location: 'cloud',
      readers: 'server-authorized',
      keyScope: 'none',
      recovery: 'server-managed',
      authorization: {
        identity: 'verified-cloud-session',
        default: 'deny',
        scope: 'resource',
        recordRules: 'domain-required',
      },
      visibleMetadata: ['tenant-id', 'resource-id', 'object-id', 'revision'],
      retention: { activeDays: 90, deletionGraceDays: 0, cloudBackupDays: 30, tombstoneDays: 30, offlineWindowDays: 0 },
      quotas: { maxUnitBytes: 32768, maxScopeBytes: 67108864, maxUnits: 10000 },
      serverProcessing: { search: true, analytics: false, ai: false, jobs: false },
    },
    {
      domain: 'private-resources',
      classification: 'restricted',
      location: 'synchronized',
      readers: 'client-keys-only',
      keyScope: 'resource',
      recovery: 'none',
      authorization: {
        identity: 'verified-cloud-session',
        default: 'deny',
        scope: 'resource',
        recordRules: 'inherit',
      },
      visibleMetadata: [
        'tenant-id',
        'resource-id',
        'object-id',
        'revision',
        'generation',
        'schema-version',
        'tombstone',
        'checkpoint',
        'ciphertext-bytes',
        'device-id',
        'recipient-id',
        'timestamp',
        'group-id',
        'public-key',
        'enrollment-challenge',
        'operation-id',
        'authorization-epoch',
        'unit-kind',
      ],
      retention: {
        activeDays: null,
        deletionGraceDays: 0,
        cloudBackupDays: 30,
        tombstoneDays: 30,
        offlineWindowDays: 30,
      },
      quotas: { maxUnitBytes: 1048576, maxScopeBytes: 67108864, maxUnits: 10000 },
      serverProcessing: { search: false, analytics: false, ai: false, jobs: false },
    },
  ],
});

export function developmentPersistenceDemos(environment: Record<string, string | undefined>): boolean {
  if (!['development', 'test'].includes(environment['NODE_ENV'] ?? '')) {
    return false;
  }

  const profile = environment['VISOMI_PERSISTENCE_DEMOS'];

  if (profile === undefined || profile === 'false') {
    return false;
  }

  if (profile !== 'true' || !developmentPersistencePolicy(environment)) {
    throw new Error('persistence_demos_unavailable');
  }

  return true;
}

/** Explicit synthetic development/test composition; never a real product's recovery decision. */
export function developmentPersistencePolicy(
  environment: Record<string, string | undefined>,
): typeof syntheticHybridPolicy | undefined {
  const profile = environment['VISOMI_PERSISTENCE_EXAMPLE'];

  if (profile === undefined || profile === 'false') {
    return undefined;
  }

  if (profile !== 'true' || !['development', 'test'].includes(environment['NODE_ENV'] ?? '')) {
    throw new Error('persistence_example_unavailable');
  }

  return parseProductPolicy(syntheticHybridPolicy);
}
