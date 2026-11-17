import { syntheticHybridPolicy } from '@visomi-stack/shared-db';
import { describe, expect, it } from 'vitest';

import { persistenceExample, validatePersistenceComposition } from './composition';

describe('explicit product adapter composition', () => {
  it('supports the synthetic hybrid and local-only client domains without enabling server readers', () => {
    expect(validatePersistenceComposition(syntheticHybridPolicy)).toEqual(syntheticHybridPolicy);
    const policy = structuredClone(syntheticHybridPolicy);
    const local = policy.domains[1];

    local.location = 'local';
    local.visibleMetadata = [];
    local.retention.cloudBackupDays = 0;
    expect(validatePersistenceComposition(policy).domains[1].readers).toBe('client-keys-only');
  });
  it.each(['ai', 'analytics', 'jobs'] as const)('rejects unavailable %s processing at composition', (capability) => {
    const policy = structuredClone(syntheticHybridPolicy);

    policy.domains[0].serverProcessing[capability] = true;
    expect(() => validatePersistenceComposition(policy)).toThrow('persistence_adapter_unsupported');
  });
  it.each(['cloud', 'record-rules', 'scope', 'metadata', 'active-retention'])(
    'rejects an unsupported client adapter: %s',
    (kind) => {
      const policy = structuredClone(syntheticHybridPolicy);
      const domain = policy.domains[1];

      if (domain.readers !== 'client-keys-only') {
        throw new Error('synthetic_fixture_invalid');
      }

      if (kind === 'cloud') {
        domain.location = 'cloud';
      }

      if (kind === 'record-rules') {
        domain.authorization.recordRules = 'domain-required';
      }

      if (kind === 'scope') {
        domain.authorization.scope = 'tenant';
      }

      if (kind === 'metadata') {
        domain.visibleMetadata = domain.visibleMetadata.filter((field) => field !== 'device-id');
      }

      if (kind === 'active-retention') {
        domain.retention.activeDays = 1;
      }

      expect(() => validatePersistenceComposition(policy)).toThrow('persistence_adapter_unsupported');
    },
  );
  it('enables the example only explicitly in development/test and rejects ambiguous or production opt-in', () => {
    expect(persistenceExample({})).toBeUndefined();
    expect(persistenceExample({ VISOMI_PERSISTENCE_EXAMPLE: 'false' })).toBeUndefined();
    for (const NODE_ENV of ['development', 'test']) {
      expect(persistenceExample({ NODE_ENV, VISOMI_PERSISTENCE_EXAMPLE: 'true' })).toEqual(syntheticHybridPolicy);
    }
    for (const environment of [
      { VISOMI_PERSISTENCE_EXAMPLE: 'true' },
      { NODE_ENV: 'production', VISOMI_PERSISTENCE_EXAMPLE: 'true' },
      { NODE_ENV: 'development', VISOMI_PERSISTENCE_EXAMPLE: 'yes' },
    ]) {
      expect(() => persistenceExample(environment)).toThrow('persistence_example_unavailable');
    }
  });
});
