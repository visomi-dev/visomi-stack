import { persistenceSchema } from '@visomi-stack/backend-db';
import { parseProductPolicy, syntheticHybridPolicy } from '@visomi-stack/shared-db';
import { HttpError } from '@visomi-stack/web-backend-shared';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { ScopeAccess } from '../access/service';

export const cloudExamplePolicy = parseProductPolicy({
  ...syntheticHybridPolicy,
  product: 'synthetic-cloud-example',
  mode: 'saas',
  domains: [
    {
      ...syntheticHybridPolicy.domains[0],
      domain: 'cloud-notes',
      quotas: { maxUnitBytes: 32768, maxScopeBytes: 655360, maxUnits: 20 },
    },
  ],
});

/** The caller has already locked and authorized this scope, with authority derived from the session. */
export async function useCloudRecordRole({ tx, actor, target }: ScopeAccess): Promise<void> {
  await tx.execute(sql`set local role visomi_cloud_example_records`);

  const result = await tx.execute<{ enforced: boolean }>(sql`
    select row_security_active('public.persistence_records'::regclass)
      and row_security_active('public.persistence_commands'::regclass)
      and not (rolsuper or rolbypassrls)
      and rolname = 'visomi_cloud_example_records' as enforced
    from pg_catalog.pg_roles where rolname = current_user
  `);

  if (result.rows[0].enforced !== true) {
    throw new HttpError(503, 'persistence_unavailable');
  }

  await tx.execute(sql`
    select set_config('visomi.cloud_actor', ${actor.principal.id}, true),
      set_config('visomi.cloud_tenant', ${target.tenantId}, true),
      set_config('visomi.cloud_scope', ${target.scopeId}, true)
  `);
}

export async function cloudChangeRecipients({ tx, actor, target }: ScopeAccess, visibleToReaders: boolean) {
  const owner = actor.principal.id;

  if (!visibleToReaders) {
    return [owner];
  }

  const { grants, memberships } = persistenceSchema;
  const readers = await tx
    .select({ id: grants.userId })
    .from(grants)
    .innerJoin(memberships, and(eq(grants.tenantId, memberships.tenantId), eq(grants.userId, memberships.userId)))
    .where(
      and(
        eq(grants.tenantId, target.tenantId),
        eq(grants.scopeId, target.scopeId),
        eq(grants.role, 'viewer'),
        isNull(memberships.revokedAt),
      ),
    );

  return [owner, ...readers.map(({ id }) => id)];
}
