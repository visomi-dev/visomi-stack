import { describe, expect, it } from 'vitest';

import { developmentPersistenceDemos } from './example';
import { domainPolicySchema, parseProductPolicy } from './policy';
import type { DomainPolicy, ProductPolicy } from './policy';

it('requires both opt-ins for the technical harness and disables it in production', () => {
  const base = { VISOMI_PERSISTENCE_EXAMPLE: 'true' };
  const optedIn = { VISOMI_PERSISTENCE_DEMOS: 'true', ...base };

  expect(developmentPersistenceDemos({ NODE_ENV: 'test', ...base })).toBe(false);
  expect(developmentPersistenceDemos({ NODE_ENV: 'test', ...base, VISOMI_PERSISTENCE_DEMOS: 'false' })).toBe(false);
  expect(developmentPersistenceDemos({ NODE_ENV: 'development', ...optedIn })).toBe(true);
  expect(developmentPersistenceDemos({ NODE_ENV: 'test', ...optedIn })).toBe(true);
  expect(() => developmentPersistenceDemos({ NODE_ENV: 'test', VISOMI_PERSISTENCE_DEMOS: 'true' })).toThrow(
    'persistence_demos_unavailable',
  );
  expect(() => developmentPersistenceDemos({ NODE_ENV: 'test', ...base, VISOMI_PERSISTENCE_DEMOS: 'yes' })).toThrow(
    'persistence_demos_unavailable',
  );
  expect(developmentPersistenceDemos({ NODE_ENV: 'production', ...optedIn })).toBe(false);
});

const operation: DomainPolicy = {
  domain: 'operations',
  classification: 'internal',
  location: 'cloud',
  readers: 'server-authorized',
  keyScope: 'none',
  recovery: 'server-managed',
  authorization: {
    identity: 'verified-cloud-session',
    default: 'deny',
    scope: 'tenant',
    recordRules: 'domain-required',
  },
  visibleMetadata: ['tenant-id', 'object-id', 'revision'],
  retention: {
    activeDays: 90,
    deletionGraceDays: 0,
    cloudBackupDays: 30,
    tombstoneDays: 30,
    offlineWindowDays: 0,
  },
  quotas: { maxUnitBytes: 1_048_576, maxScopeBytes: 67_108_864, maxUnits: 10_000 },
  serverProcessing: { search: true, analytics: false, ai: false, jobs: true },
};
const privateResource: DomainPolicy = {
  ...operation,
  domain: 'private-resources',
  classification: 'restricted',
  location: 'synchronized',
  readers: 'client-keys-only',
  keyScope: 'resource',
  recovery: 'user-held-recovery-key',
  authorization: { ...operation.authorization, scope: 'resource' },
  visibleMetadata: ['tenant-id', 'resource-id', 'object-id', 'revision', 'generation', 'tombstone', 'checkpoint'],
  retention: { ...operation.retention, offlineWindowDays: 30 },
  serverProcessing: { search: false, analytics: false, ai: false, jobs: false },
};
const hybrid: ProductPolicy = {
  version: 1,
  product: 'synthetic-example',
  mode: 'hybrid',
  identity: { location: 'cloud', readers: 'server-authorized' },
  domains: [operation, privateResource],
};

describe('product data policy trust boundary', () => {
  it.each([
    ['saas', [operation]],
    ['zk', [privateResource]],
    ['hybrid', [operation, privateResource]],
  ] as const)('accepts an explicit %s manifest with cloud identity', (mode, domains) => {
    const input = { ...hybrid, mode, domains };

    expect(parseProductPolicy(input)).toEqual(input);
  });

  it.each(['local', 'cloud', 'synchronized'] as const)('allows client-held keys with %s persistence', (location) => {
    const input = {
      ...privateResource,
      location,
      ...(location === 'local'
        ? { visibleMetadata: [], retention: { ...privateResource.retention, cloudBackupDays: 0 } }
        : {}),
    };

    expect(domainPolicySchema.safeParse(input).success).toBe(true);
  });

  it.each(['local', 'synchronized'] as const)('rejects server-readable %s persistence in v1', (location) => {
    expect(domainPolicySchema.safeParse({ ...operation, location }).success).toBe(false);
  });

  it.each(['search', 'analytics', 'ai', 'jobs'] as const)('rejects server %s on a ZK domain', (capability) => {
    const input = {
      ...privateResource,
      serverProcessing: { ...privateResource.serverProcessing, [capability]: true },
    };

    expect(domainPolicySchema.safeParse(input).success).toBe(false);
  });

  it.each([
    { keyScope: 'record' },
    { keyScope: 'none' },
    { recovery: 'server-managed' },
    { readers: 'server-authorized' },
    { authorization: { ...privateResource.authorization, default: 'allow' } },
    { authorization: { ...privateResource.authorization, identity: 'client-user-id' } },
    { visibleMetadata: ['tenant-id', 'title'] },
    { visibleMetadata: [...privateResource.visibleMetadata, 'tenant-id'] },
    { visibleMetadata: privateResource.visibleMetadata.filter((field) => field !== 'resource-id') },
    { visibleMetadata: privateResource.visibleMetadata.filter((field) => field !== 'checkpoint') },
    { retention: { ...privateResource.retention, tombstoneDays: 29 } },
    { quotas: { ...privateResource.quotas, maxUnitBytes: 67_108_865 } },
    { quotas: { ...privateResource.quotas, maxScopeBytes: Number.MAX_SAFE_INTEGER + 1 } },
    { plaintext: 'synthetic-secret' },
  ])('rejects incoherent or unapproved domain fields: %j', (override) => {
    expect(domainPolicySchema.safeParse({ ...privateResource, ...override }).success).toBe(false);
  });

  it.each([
    { version: 2 },
    { mode: 'saas' },
    { identity: { location: 'local', readers: 'client-keys-only' } },
    { domains: [] },
    { domains: [operation, operation] },
    { domains: [{ ...operation, domain: 'identity' }] },
    { domains: Array.from({ length: 65 }, (_, index) => ({ ...operation, domain: `domain-${index}` })) },
    { fallback: 'server-readable' },
  ])('rejects invalid manifests with a fixed public code: %j', (override) => {
    expect(() => parseProductPolicy({ ...hybrid, ...override })).toThrow(/^persistence_policy_invalid$/);
  });

  it('keeps authorization granularity distinct from the key domain', () => {
    const policy = domainPolicySchema.parse({ ...privateResource, keyScope: 'tenant' });

    expect(policy.authorization.recordRules).toBe('domain-required');
    expect(policy.keyScope).toBe('tenant');
  });

  it('rejects cloud metadata and cloud backups for a local-only domain', () => {
    expect(domainPolicySchema.safeParse({ ...privateResource, location: 'local' }).success).toBe(false);
    expect(domainPolicySchema.safeParse({ ...privateResource, location: 'local', visibleMetadata: [] }).success).toBe(
      false,
    );
  });

  it('does not leak input through errors or mutate the caller configuration', () => {
    const original = structuredClone(hybrid);
    const parsed = parseProductPolicy(original);

    parsed.domains[0].visibleMetadata.push('timestamp');
    expect(original).toEqual(hybrid);
    expect(() => parseProductPolicy({ ...hybrid, secret: 'synthetic-marker' })).toThrow(/^persistence_policy_invalid$/);
  });
});
