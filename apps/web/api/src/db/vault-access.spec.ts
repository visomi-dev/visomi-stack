import { syntheticHybridPolicy } from '@visomi-stack/shared-db';
import { describe, expect, it } from 'vitest';

import type { Access, ScopeAccess } from '../access/service';

import { VaultAccess, scopeId } from './vault-access';

const tenantId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const resourceId = '33333333-3333-4333-8333-333333333333';
const vault = new VaultAccess({ policy: syntheticHybridPolicy } as Access);
const ancestry: ScopeAccess['scope'][] = [
  { id: resourceId, kind: 'resource', tenantId, parentId: groupId, objectBackup: false, deletingBackup: false },
  { id: groupId, kind: 'group', tenantId, parentId: tenantId, objectBackup: false, deletingBackup: false },
  { id: tenantId, kind: 'tenant', tenantId, parentId: null, objectBackup: false, deletingBackup: false },
];
const context: Pick<ScopeAccess, 'target' | 'scope' | 'ancestry'> = {
  target: { tenantId, scopeId: resourceId },
  scope: ancestry[0],
  ancestry,
};

describe('key scope derivation separate from target authority', () => {
  it('derives tenant, group and resource identities without flattening key scope to the record', () => {
    expect(scopeId(vault.identity(context, 'tenant'))).toBe(tenantId);
    expect(scopeId(vault.identity(context, 'group'))).toBe(groupId);
    expect(scopeId(vault.identity(context, 'resource'))).toBe(resourceId);
    expect(
      vault.identity({ ...context, ancestry: ancestry.filter((entry) => entry.kind !== 'group') }, 'resource'),
    ).toEqual({ kind: 'resource', tenantId, groupId: null, resourceId });
    const policy = vault.policy('private-resources');

    expect(() =>
      vault.key(
        context,
        { ...policy, visibleMetadata: policy.visibleMetadata.filter((field) => field !== 'group-id') },
        1,
      ),
    ).toThrow('domain_metadata_incompatible');

    expect(vault.key(context, { ...policy, keyScope: 'tenant' }, 2)).toMatchObject({
      generation: 2,
      scope: { kind: 'tenant' },
    });
    expect(() => vault.key(context, { ...policy, keyScope: 'group' }, 1, true)).toThrow('scope_access_denied');
    expect(() => vault.key({ ...context, ancestry: [] }, policy, 1)).toThrow('scope_access_denied');
  });
  it('rejects missing ancestry rather than constructing a partially bound scope', () => {
    expect(() => vault.identity({ ...context, ancestry: [] }, 'resource')).toThrow('scope_access_denied');
    expect(() => vault.identity({ ...context, ancestry: [] }, 'group')).toThrow('scope_access_denied');
  });
  it('refuses SaaS, missing, local-only and unspecified record-rule adapters', () => {
    expect(() => vault.policy('operations')).toThrow('domain_adapter_incompatible');
    expect(() => vault.policy('missing')).toThrow('domain_adapter_incompatible');
    for (const changed of [
      { location: 'local' },
      { authorization: { ...syntheticHybridPolicy.domains[1].authorization, recordRules: 'domain-required' } },
    ]) {
      const policy = structuredClone(syntheticHybridPolicy);

      Object.assign(policy.domains[1], changed);
      expect(() => new VaultAccess({ policy } as Access).policy('private-resources')).toThrow(
        'domain_adapter_incompatible',
      );
    }
  });
});
