import { readFile } from 'node:fs/promises';

import { createOperationId } from '@visomi-stack/shared-db';
import { sql } from 'drizzle-orm';
import { beforeAll, expect, it } from 'vitest';
import { z } from 'zod';

import type { Transaction } from '../../src/auth/shared/identity';

import { authRuntime, client, cloudMail, cloudNotice, mutation, resource } from './support/persistence';

const prefix = '/example/cloud/tenants';

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

it('reclaims expired note capacity under the restricted Cloud role before creating a note', async () => {
  const owner = await client();
  const root = await owner.call(prefix, 'POST', {});
  const workspace = await owner.call(`${base(root.body)}/children`, 'POST', { kind: 'resource' });
  const target = workspace.body;
  const records = `${base(target)}/domains/cloud-notes/records`;
  const actor = owner.actor.principal.id;

  await underRls(actor, target, (tx) =>
    tx.execute(sql`
    insert into public.persistence_records (id, tenant_id, scope_id, domain, owner_id, audience, title, body, revision, created_at)
    select gen_random_uuid(), ${target.tenantId}, ${target.scopeId}, 'cloud-notes', ${actor}, 'owner',
      'Synthetic expired title', 'Synthetic expired note', 1, now() - interval '91 days'
    from generate_series(1, 20)
  `),
  );

  await expect(owner.call(records)).resolves.toMatchObject({ status: 200, body: { items: [] } });

  await expect(owner.call(records, 'POST', mutation('New test note'))).resolves.toMatchObject({ status: 200 });

  const result = await underRls(actor, target, (tx) =>
    tx.execute<{ scrubbed: number; active: number }>(sql`
    select count(*) filter (where deleted_at is not null and title = '' and body = '')::int as scrubbed,
      count(*) filter (where deleted_at is null)::int as active
    from public.persistence_records
  `),
  );

  expect(result.rows).toEqual([{ scrubbed: 20, active: 1 }]);
});

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
  const otherWorkspace = await owner.call(`${base(root.body)}/children`, 'POST', { kind: 'resource' });
  const workspacesPath = '/example/cloud/workspaces';
  const [first, second] = [target, otherWorkspace.body].sort((a, b) => a.scopeId.localeCompare(b.scopeId));

  await expect(owner.call(`${workspacesPath}?limit=1`)).resolves.toMatchObject({
    status: 200,
    body: {
      items: [{ ...first, owner: true, createdAt: expect.any(String) }],
      next: first.scopeId,
    },
  });

  await expect(owner.call(`${workspacesPath}?limit=1&after=${first.scopeId}`)).resolves.toMatchObject({
    status: 200,
    body: { items: [{ ...second, owner: true }], next: null },
  });

  await expect(outsider.call(workspacesPath)).resolves.toMatchObject({
    status: 200,
    body: { items: [], next: null },
  });

  await expect(owner.call('/example/vault/workspaces')).resolves.toMatchObject({
    status: 200,
    body: { items: [], next: null },
  });

  const records = `${base(target)}/domains/cloud-notes/records`;
  const ownerId = owner.actor.principal.id;
  const collaboratorId = collaborator.actor.principal.id;
  const privateNote = await owner.call(records, 'POST', mutation('Owner’s test note'));
  const sharedNote = await owner.call(records, 'POST', mutation('Shared test note', 'scope'));

  expect(privateNote.status).toBe(200);
  expect(sharedNote.status).toBe(200);
  expect(cloudNotice.mock.calls).toEqual([[ownerId], [ownerId]]);

  await expect(owner.call(records)).resolves.toMatchObject({ body: { canWrite: true } });

  await expect(outsider.call(records)).resolves.toMatchObject({ status: 403 });

  await expect(collaborator.call(records)).resolves.toMatchObject({ status: 403 });

  await expect(owner.call(records, 'POST', { ...mutation(), actor: collaboratorId })).resolves.toMatchObject({
    status: 400,
  });

  await expect(owner.call(records.replace('/example/cloud', '/example/vault'))).resolves.toMatchObject({ status: 409 });

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

  cloudNotice.mockClear().mockRejectedValueOnce(new Error('Synthetic transport unavailable'));

  await expect(member(true)).resolves.toMatchObject({ status: 200 });

  await expect(readByRole(collaboratorId)).resolves.toEqual([]);

  await expect(grant('editor')).resolves.toMatchObject({ status: 403 });

  cloudNotice.mockRejectedValueOnce(new Error('Synthetic transport unavailable'));

  await expect(grant('viewer')).resolves.toMatchObject({ status: 200 });

  await expect(collaborator.call(workspacesPath)).resolves.toMatchObject({
    status: 200,
    body: { items: [{ ...target, owner: false }], next: null },
  });

  expect(cloudNotice.mock.calls).toEqual([[collaboratorId], [collaboratorId]]);

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

  cloudNotice.mockClear().mockRejectedValueOnce(new Error('Synthetic transport unavailable'));

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
  expect(cloudNotice.mock.calls).toEqual([[ownerId], [collaboratorId]]);

  await expect(collaborator.call(`${records}/${sharedNote.body.id}`)).resolves.toMatchObject({
    body: { title: 'Updated shared test note' },
  });

  await expect(grant('blocked')).resolves.toMatchObject({ status: 200 });

  await expect(collaborator.call(workspacesPath)).resolves.toMatchObject({ body: { items: [], next: null } });

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

it('allows only verified accounts to redeem an active link and rejects revoked readers, expired links and replaced links', async () => {
  const [owner, reader, outsider, unverified] = await Promise.all([client(), client(), client(), client(false)]);
  const root = await owner.call(prefix, 'POST', {});
  const { body: target } = await owner.call(`${base(root.body)}/children`, 'POST', { kind: 'resource' });
  const sharing = `${base(target)}/sharing`;
  const join = '/example/cloud/sharing/join';
  const notes = `${base(target)}/domains/cloud-notes/records`;

  await expect(owner.call(`${base(root.body)}/sharing`)).resolves.toMatchObject({ status: 403 });

  await expect(owner.call(sharing)).resolves.toMatchObject({ body: { linkExpiresAt: null, readers: [] } });

  await expect(outsider.call(`${sharing}/link`, 'POST', {})).resolves.toMatchObject({ status: 403 });

  const original = await owner.call(`${sharing}/link`, 'POST', {});
  const { token } = z.object({ token: z.string().length(43) }).parse(original.body);

  expect(original.status).toBe(200);

  await expect(unverified.call(join, 'POST', { token })).resolves.toMatchObject({ status: 403 });

  await expect(outsider.call(notes)).resolves.toMatchObject({ status: 403 });

  cloudNotice.mockRejectedValueOnce(new Error('Synthetic transport unavailable'));

  await expect(owner.call(join, 'POST', { token })).resolves.toMatchObject({ status: 200 });

  await expect(reader.call(join, 'POST', { token })).resolves.toMatchObject({ status: 200, body: target });

  await expect(reader.call(join, 'POST', { token })).resolves.toMatchObject({ status: 200, body: target });

  await expect(reader.call(sharing)).resolves.toMatchObject({ status: 403 });

  const readerId = reader.actor.principal.id;

  await resource.pool.query("update persistence_grants set role = 'manager' where scope_id = $1 and user_id = $2", [
    target.scopeId,
    readerId,
  ]);

  await expect(reader.call(sharing)).resolves.toMatchObject({ status: 403 });

  await resource.pool.query("update persistence_grants set role = 'viewer' where scope_id = $1 and user_id = $2", [
    target.scopeId,
    readerId,
  ]);

  await expect(owner.call(sharing)).resolves.toMatchObject({
    body: { linkExpiresAt: expect.any(String), readers: [{ id: reader.actor.principal.id }] },
  });

  await expect(owner.call(`${sharing}/readers/${reader.actor.principal.id}`, 'DELETE')).resolves.toMatchObject({
    status: 200,
  });

  await expect(owner.call(`${sharing}/readers/${reader.actor.principal.id}`, 'DELETE')).resolves.toMatchObject({
    status: 200,
  });

  await expect(reader.call(join, 'POST', { token })).resolves.toMatchObject({ status: 403 });

  await expect(reader.call(notes)).resolves.toMatchObject({ status: 403 });

  const replacement = await owner.call(`${sharing}/link`, 'POST', {});
  const { token: newToken } = z.object({ token: z.string() }).parse(replacement.body);

  await expect(outsider.call(join, 'POST', { token })).resolves.toMatchObject({ status: 403 });

  await resource.pool.query(
    "update cloud_share_links set expires_at = now() - interval '1 second' where scope_id = $1",
    [target.scopeId],
  );

  await expect(outsider.call(join, 'POST', { token: newToken })).resolves.toMatchObject({ status: 403 });

  const active = await owner.call(`${sharing}/link`, 'POST', {});
  const current = z.object({ token: z.string() }).parse(active.body);

  await expect(
    owner.call(`${base(root.body)}/members`, 'PUT', { userId: reader.actor.principal.id, active: false }),
  ).resolves.toMatchObject({ status: 200 });

  await expect(reader.call(join, 'POST', { token: current.token })).resolves.toMatchObject({ status: 403 });

  await expect(owner.call(`${sharing}/link`, 'DELETE')).resolves.toMatchObject({ status: 200 });

  await expect(outsider.call(join, 'POST', { token: current.token })).resolves.toMatchObject({ status: 403 });
});

it('emails only existing verified accounts and reports transport failure separately from read access', async () => {
  const [owner, reader, unverified] = await Promise.all([client(), client(), client(false)]);
  const root = await owner.call(prefix, 'POST', {});
  const { body: target } = await owner.call(`${base(root.body)}/children`, 'POST', { kind: 'resource' });
  const emailPath = `${base(target)}/sharing/email`;
  const notes = `${base(target)}/domains/cloud-notes/records`;
  const email = `${reader.actor.principal.id}@example.test`;

  await expect(owner.call(emailPath, 'POST', { email, locale: 'en' })).resolves.toMatchObject({ status: 503 });

  authRuntime.mail = { send: cloudMail, close: () => undefined };

  try {
    for (const unsupported of [
      'missing@example.test',
      `${unverified.actor.principal.id}@example.test`,
      `${owner.actor.principal.id}@example.test`,
    ]) {
      await expect(owner.call(emailPath, 'POST', { email: unsupported, locale: 'en' })).resolves.toMatchObject({
        status: 400,
        body: { error: 'cloud_recipient_unavailable' },
      });
    }

    expect(cloudMail).not.toHaveBeenCalled();

    cloudMail.mockRejectedValueOnce(new Error('Synthetic SMTP failure'));

    await expect(owner.call(emailPath, 'POST', { email, locale: 'en' })).resolves.toMatchObject({
      status: 200,
      body: { sent: false },
    });

    await expect(reader.call(notes)).resolves.toMatchObject({ status: 200, body: { canWrite: false } });

    await expect(owner.call(emailPath, 'POST', { email, locale: 'es' })).resolves.toMatchObject({
      status: 200,
      body: { sent: true },
    });

    expect(cloudMail).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: email,
        subject: 'Te compartieron un espacio en Stack',
        text: expect.stringContaining(`/app/es/example/cloud/${target.tenantId}/${target.scopeId}`),
      }),
    );
  } finally {
    authRuntime.mail = undefined;
  }
});
