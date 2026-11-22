import { defineRoute } from '@visomi-stack/web-backend-shared';
import { z } from 'zod';
import { exampleWorkspacePageSchema, productPolicySchema } from '@visomi-stack/shared-db';

import { grantInputSchema, memberInputSchema, scopeInputSchema, targetSchema } from '../access/contracts';
import { commonErrors, cookieSecurity, csrfSecurity } from '../auth/shared/contracts';

import { recordMutationSchema } from './records';
import { maintenanceSchema } from './maintenance';

const params = targetSchema.extend({ domain: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) });
const query = z.strictObject({
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().min(1).max(100).optional(),
});
const record = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  audience: z.enum(['owner', 'scope']),
  revision: z.number().int().positive(),
});
const recordPage = z.strictObject({
  items: z.array(record),
  next: z.uuid().nullable(),
  canWrite: z.boolean().optional(),
});
const changed = z.strictObject({ changed: z.literal(true) });
const response = (schema: z.ZodType) => ({
  ...commonErrors,
  200: {
    description: 'Authorized result. Response fields are explicitly projected; this does not grant key possession.',
    content: { 'application/json': { schema } },
  },
});
const base = {
  tags: ['persistence'],
  security: csrfSecurity,
  description:
    'Opt-in product composition. Verified cloud session, configured Origin/CSRF on mutations, and current tenant/scope/record authority are required. No automatic policy migration or ZK plaintext fallback.',
};
const path = '/tenants/:tenantId/scopes/:scopeId';

export const persistenceContracts = {
  listWorkspaces: defineRoute({
    ...base,
    security: cookieSecurity,
    method: 'get',
    path: '/workspaces',
    operationId: 'persistence_example_workspaces',
    summary: 'List workspaces visible to the verified account in this example',
    request: z.object({ query: query.pick({ after: true, limit: true }) }),
    responses: response(exampleWorkspacePageSchema),
  }),
  maintenance: defineRoute({
    ...base,
    method: 'post',
    path: `${path}/domains/:domain/maintenance`,
    operationId: 'persistence_maintenance',
    summary: 'Run a bounded owner-authorized retention batch using the fixed product policy',
    request: z.object({ params, body: maintenanceSchema }),
    responses: response(
      z.strictObject({
        receipts: z.number().int().nonnegative(),
        scrubbed: z.number().int().nonnegative(),
        purged: z.number().int().nonnegative(),
        events: z.number().int().nonnegative(),
        tombstones: z.number().int().nonnegative(),
        challenges: z.number().int().nonnegative(),
        abandonedObjects: z.number().int().nonnegative().optional(),
      }),
    ),
  }),
  policy: defineRoute({
    ...base,
    security: cookieSecurity,
    method: 'get',
    path: '/policy',
    operationId: 'persistence_policy',
    summary: 'Read the configured product manifest without unlocking private content',
    request: z.object({}),
    responses: response(
      z.strictObject({
        policy: productPolicySchema,
        origin: z.url(),
        rpId: z.string(),
        objectBackups: z.literal(true).optional(),
        hybridHarness: z.literal(true).optional(),
      }),
    ),
  }),
  createTenant: defineRoute({
    ...base,
    method: 'post',
    path: '/tenants',
    operationId: 'persistence_create_tenant',
    summary: 'Create a product tenant',
    request: z.object({ body: z.strictObject({}) }),
    responses: response(targetSchema),
  }),
  createScope: defineRoute({
    ...base,
    method: 'post',
    path: `${path}/children`,
    operationId: 'persistence_create_scope',
    summary: 'Create an authorized child scope',
    request: z.object({ params: targetSchema, body: scopeInputSchema }),
    responses: response(targetSchema),
  }),
  member: defineRoute({
    ...base,
    method: 'put',
    path: `${path}/members`,
    operationId: 'persistence_member',
    summary: 'Change tenant membership',
    request: z.object({ params: targetSchema, body: memberInputSchema }),
    responses: response(changed),
  }),
  grant: defineRoute({
    ...base,
    method: 'put',
    path: `${path}/grants`,
    operationId: 'persistence_grant',
    summary: 'Set a scoped role or explicit block',
    request: z.object({ params: targetSchema, body: grantInputSchema }),
    responses: response(changed),
  }),
};

export const persistenceRecordContracts = {
  list: defineRoute({
    ...base,
    security: cookieSecurity,
    method: 'get',
    path: `${path}/domains/:domain/records`,
    operationId: 'persistence_records',
    summary: 'List or search authorized SaaS records',
    request: z.object({ params, query }),
    responses: response(recordPage),
  }),
  export: defineRoute({
    ...base,
    security: cookieSecurity,
    method: 'get',
    path: `${path}/domains/:domain/records/export`,
    operationId: 'persistence_export',
    summary: 'Export a page of authorized SaaS records',
    request: z.object({ params, query }),
    responses: response(recordPage),
  }),
  read: defineRoute({
    ...base,
    security: cookieSecurity,
    method: 'get',
    path: `${path}/domains/:domain/records/:id`,
    operationId: 'persistence_record',
    summary: 'Read an authorized SaaS record',
    request: z.object({ params: params.extend({ id: z.uuid() }) }),
    responses: response(record),
  }),
  mutate: defineRoute({
    ...base,
    method: 'post',
    path: `${path}/domains/:domain/records`,
    operationId: 'persistence_mutation',
    summary: 'Create, replace or delete a SaaS record idempotently',
    request: z.object({ params, body: recordMutationSchema }),
    responses: response(z.strictObject({ id: z.uuid(), revision: z.number().int().positive(), deleted: z.boolean() })),
  }),
};
