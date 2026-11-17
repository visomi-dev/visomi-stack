import { vaultSchema } from '@visomi-stack/backend-shared';
import type { DomainPolicy, KeyDomain, CryptoScope } from '@visomi-stack/shared-persistence';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq } from 'drizzle-orm';

import type { Access, ScopeAccess } from '../access/service';

type PrivatePolicy = Extract<DomainPolicy, { readers: 'client-keys-only' }>;
type ScopeContext = Pick<ScopeAccess, 'target' | 'scope' | 'ancestry'>;
export const keyPredicate = (key: KeyDomain) =>
  and(
    eq(vaultSchema.keyScopes.tenantId, key.scope.tenantId),
    eq(vaultSchema.keyScopes.scopeId, scopeId(key.scope)),
    eq(vaultSchema.keyScopes.domain, key.domain),
  );
export const scopeId = (scope: CryptoScope) =>
  scope.kind === 'tenant' ? scope.tenantId : scope.kind === 'group' ? scope.groupId : scope.resourceId;

export class VaultAccess {
  constructor(readonly access: Access) {}

  policy(domain: string): PrivatePolicy {
    const policy = this.access.policy.domains.find((entry) => entry.domain === domain);

    if (
      !policy ||
      policy.readers !== 'client-keys-only' ||
      policy.location !== 'synchronized' ||
      policy.authorization.recordRules !== 'inherit'
    ) {
      throw new HttpError(409, 'domain_adapter_incompatible');
    }

    return policy;
  }

  key(context: ScopeContext, policy: PrivatePolicy, generation: number, requireKeyScope = false): KeyDomain {
    if (context.ancestry.some((entry) => entry.kind === 'group') && !policy.visibleMetadata.includes('group-id')) {
      throw new HttpError(409, 'domain_metadata_incompatible');
    }

    const scope = context.ancestry.find((entry) => entry.kind === policy.keyScope);

    if (!scope || (requireKeyScope && scope.id !== context.scope.id)) {
      throw new HttpError(403, 'scope_access_denied');
    }

    return {
      product: this.access.policy.product,
      domain: policy.domain,
      generation,
      scope: this.identity(context, scope.kind),
    };
  }

  identity(context: ScopeContext, kind = context.scope.kind): CryptoScope {
    const tenantId = context.target.tenantId;
    const groupId = context.ancestry.find((entry) => entry.kind === 'group')?.id;

    if (kind === 'tenant') {
      return { kind, tenantId };
    }

    if (kind === 'group' && groupId) {
      return { kind, tenantId, groupId };
    }

    const resourceId = context.ancestry.find((entry) => entry.kind === 'resource')?.id;

    if (kind === 'resource' && resourceId) {
      return { kind, tenantId, groupId: groupId ?? null, resourceId };
    }

    throw new HttpError(403, 'scope_access_denied');
  }

  async registry(context: ScopeAccess, policy: PrivatePolicy, requireKeyScope = false) {
    const key = this.key(context, policy, 1, requireKeyScope);
    const [registry] = await context.tx.select().from(vaultSchema.keyScopes).where(keyPredicate(key));

    if (!registry) {
      throw new HttpError(409, 'key_scope_uninitialized');
    }

    return { registry, key: { ...key, generation: registry.generation } };
  }
}
