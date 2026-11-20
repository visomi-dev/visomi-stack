import { readFile } from 'node:fs/promises';

import { createOperationId } from '@visomi-stack/shared-db';
import { sql } from 'drizzle-orm';
import { beforeAll, expect, it } from 'vitest';

import type { Transaction } from '../../src/auth/shared/identity';

import { client, enablePersistenceDemos, mutation, resource } from './support/persistence';

enablePersistenceDemos();

const prefix = '/persistence/cloud-example/tenants';

type Target = { tenantId: string; scopeId: string };
const base = ({ tenantId, scopeId }: Target) => `${prefix}/${tenantId}/scopes/${scopeId}`;

beforeAll(async () => {
  const script = await readFile(
    new URL('../../../../../libs/backend/db/tools/cloud-example-rls.sql', import.meta.url),
    'utf8',
  );

  await resource.pool.query(script);
});

function underRls<T>(actor: string, target: Target, check: (tx: Transaction) => Promise<T>) {
  return resource.db.transaction(async (tx) => {
    await tx.execute(sql`set local role visomi_cloud_example_records`);

    await tx.execute(sql`
      select set_config('visomi.cloud_actor', ${actor}, true),
        set_config('visomi.cloud_tenant', ${target.tenantId}, true),
        set_config('visomi.cloud_scope', ${target.scopeId}, true)
    `);

    return check(tx);
  });
}

it('enforces Cloud owner/shared CRUD, explicit read access, and revocation at the API and in PostgreSQL', async () => {
  const [owner, collaborator, outsider] = await Promise.all([client(), client(), client()]);
  const root = await owner.call(prefix, 'POST', {});

  expect(root.status).toBe(200);

  await expect(
    owner.call(`${base(root.body)}/children`, 'POST', { kind: 'resource', objectBackup: true }),
  ).resolves.toMatchObject({ status: 403 });

  const workspace = await owner.call(`${base(root.body)}/children`, 'POST', { kind: 'resource' });

  expect(workspace.status).toBe(200);

  const target = workspace.body;
  const records = `${base(target)}/domains/cloud-notes/records`;
  const ownerId = owner.actor.principal.id;
  const collaboratorId = collaborator.actor.principal.id;
  const privateNote = await owner.call(records, 'POST', mutation('Owner’s test note'));
  const sharedNote = await owner.call(records, 'POST', mutation('Shared test note', 'scope'));

  expect(privateNote.status).toBe(200);
  expect(sharedNote.status).toBe(200);

  await expect(owner.call(records)).resolves.toMatchObject({ body: { canWrite: true } });

  await expect(outsider.call(records)).resolves.toMatchObject({ status: 403 });

  await expect(collaborator.call(records)).resolves.toMatchObject({ status: 403 });

  await expect(owner.call(records, 'POST', { ...mutation(), actor: collaboratorId })).resolves.toMatchObject({
    status: 400,
  });

  await expect(owner.call(records.replace('/cloud-example', ''))).resolves.toMatchObject({ status: 409 });

  await expect(
    owner.call(`${base(target)}/domains/cloud-notes/maintenance`, 'POST', { limit: 1 }),
  ).resolves.toMatchObject({ status: 409 });

  await expect(owner.call(`${base(root.body)}/children`, 'POST', { kind: 'group' })).resolves.toMatchObject({
    status: 403,
  });

  await expect(owner.call(`${base(target)}/children`, 'POST', { kind: 'resource' })).resolves.toMatchObject({
    status: 403,
  });

  await expect(
    owner.call(`${base(root.body)}/grants`, 'PUT', { userId: collaboratorId, role: 'viewer' }),
  ).resolves.toMatchObject({ status: 403 });

  const readByRole = async (id: string, scope: Target = target) =>
    underRls(id, scope, async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`select id from public.persistence_records order by id`);

      return result.rows.map((row) => row.id);
    });

  await underRls(ownerId, target, async (tx) => {
    const info = await tx.execute<Record<string, unknown>>(sql`
      select current_user as role, rolsuper, rolbypassrls, rolcanlogin,
        row_security_active('public.persistence_records'::regclass) as active,
        (select relowner <> oid from pg_class where oid = 'public.persistence_records'::regclass) as nonowner
      from pg_roles where rolname = current_user
    `);

    expect(info.rows).toEqual([
      {
        role: 'visomi_cloud_example_records',
        rolsuper: false,
        rolbypassrls: false,
        rolcanlogin: false,
        active: true,
        nonowner: true,
      },
    ]);
  });

  await expect(readByRole(ownerId)).resolves.toEqual([privateNote.body.id, sharedNote.body.id].sort());

  await expect(readByRole(ownerId, { ...target, scopeId: root.body.scopeId })).resolves.toEqual([]);

  await expect(readByRole(outsider.actor.principal.id)).resolves.toEqual([]);

  await expect(readByRole(collaboratorId)).resolves.toEqual([]);

  const member = (active: boolean) =>
    owner.call(`${base(root.body)}/members`, 'PUT', { userId: collaboratorId, active });
  const grant = (role: string) => owner.call(`${base(target)}/grants`, 'PUT', { userId: collaboratorId, role });

  await expect(member(true)).resolves.toMatchObject({ status: 200 });

  await expect(readByRole(collaboratorId)).resolves.toEqual([]);

  await expect(grant('editor')).resolves.toMatchObject({ status: 403 });

  await expect(grant('viewer')).resolves.toMatchObject({ status: 200 });

  await expect(readByRole(collaboratorId)).resolves.toEqual([sharedNote.body.id]);

  await expect(collaborator.call(records)).resolves.toMatchObject({
    body: {
      canWrite: false,
      items: [{ id: sharedNote.body.id }],
    },
  });

  await expect(collaborator.call(`${records}/${privateNote.body.id}`)).resolves.toMatchObject({ status: 404 });

  await expect(collaborator.call(`${records}/${sharedNote.body.id}`)).resolves.toMatchObject({ status: 200 });

  await expect(collaborator.call(records, 'POST', mutation())).resolves.toMatchObject({ status: 403 });

  const changedByReader = await underRls(collaboratorId, target, (tx) =>
    tx.execute<{ id: string }>(
      sql`update public.persistence_records set title = 'Unauthorized test write' returning id`,
    ),
  );

  expect(changedByReader.rows).toEqual([]);

  await expect(
    underRls(collaboratorId, target, (tx) =>
      tx.execute(sql`
    insert into public.persistence_records (id, tenant_id, scope_id, domain, owner_id, audience, title, body, revision)
    values (gen_random_uuid(), ${target.tenantId}, ${target.scopeId}, 'cloud-notes', ${collaboratorId}, 'scope', '', '', 1)
  `),
    ),
  ).rejects.toMatchObject({ cause: { code: '42501' } });

  const updated = await owner.call(records, 'POST', {
    kind: 'update',
    operationId: createOperationId(globalThis.crypto),
    id: sharedNote.body.id,
    expectedRevision: 1,
    title: 'Updated shared test note',
    body: 'Updated synthetic content',
    audience: 'scope',
  });

  expect(updated.status).toBe(200);

  await expect(collaborator.call(`${records}/${sharedNote.body.id}`)).resolves.toMatchObject({
    body: { title: 'Updated shared test note' },
  });

  await expect(grant('blocked')).resolves.toMatchObject({ status: 200 });

  await expect(readByRole(collaboratorId)).resolves.toEqual([]);

  await expect(collaborator.call(records)).resolves.toMatchObject({ status: 403 });

  await expect(grant('viewer')).resolves.toMatchObject({ status: 200 });

  await expect(member(false)).resolves.toMatchObject({ status: 200 });

  await expect(readByRole(collaboratorId)).resolves.toEqual([]);

  await expect(collaborator.call(records)).resolves.toMatchObject({ status: 403 });

  const deleted = await owner.call(records, 'POST', {
    kind: 'delete',
    operationId: createOperationId(globalThis.crypto),
    id: sharedNote.body.id,
    expectedRevision: 2,
  });

  expect(deleted.status).toBe(200);

  await expect(owner.call(`${records}/${sharedNote.body.id}`)).resolves.toMatchObject({ status: 404 });

  await resource.db.transaction(async (tx) => {
    await tx.execute(sql`set local role visomi_cloud_example_records`);

    const result = await tx.execute<{ id: string }>(sql`select id from public.persistence_records`);

    expect(result.rows).toEqual([]);
  });

  await resource.pool.query('alter table public.persistence_records disable row level security');

  try {
    await expect(owner.call(records)).resolves.toMatchObject({ status: 503 });
  } finally {
    await resource.pool.query('alter table public.persistence_records enable row level security');
  }
});
