import { randomUUID } from 'node:crypto';

import { createOperationId } from '@visomi-stack/shared-db';
import { authSchema, createDatabase, persistenceSchema } from '@visomi-stack/backend-db';
import { runTestCompose } from '@visomi-stack/dev-testing/postgres';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { Access } from '../../src/access/service';
import { SaasRecords } from '../../src/db/records';

import {
  base,
  client,
  collection,
  fixture,
  grant,
  mutation,
  origin,
  policy,
  postgres,
  resource,
} from './support/persistence';

describe('real PostgreSQL and HTTP persistence boundaries', () => {
  it('sanitizes malformed/oversized bodies and unexpected adapter failures', async () => {
    const owner = await client();
    const malformed = await owner.sendRaw('/persistence/tenants', '{synthetic-private-parse-marker');
    const oversized = await owner.sendRaw('/persistence/tenants', JSON.stringify({ private: 'x'.repeat(33000) }));

    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: 'request_invalid' });
    expect(oversized.status).toBe(413);
    const failure = vi
      .spyOn(Access.prototype, 'createTenant')
      .mockRejectedValueOnce(new Error('synthetic-private-driver-marker'));

    try {
      const response = await owner.call('/persistence/tenants', 'POST', {});

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: 'persistence_unavailable' });
    } finally {
      failure.mockRestore();
    }
  });

  it('rejects invalid targets, missing tenants, malformed ancestry and membership changes below the tenant', async () => {
    const f = await fixture();
    const access = new Access(resource.db, policy);

    await expect(
      access.withScope(f.owner.actor, { tenantId: 'invalid', scopeId: f.target.scopeId }, 'read', async () => true),
    ).rejects.toMatchObject({ code: 'request_invalid' });

    const missing = await f.owner.call(collection({ tenantId: randomUUID(), scopeId: randomUUID() }));

    expect(missing.status).toBe(403);
    const invalidGroup = randomUUID();

    await resource.db
      .insert(persistenceSchema.scopes)
      .values({ id: invalidGroup, tenantId: f.tenant.tenantId, kind: 'group', parentId: f.group.scopeId });

    const denied = await f.owner.call(collection({ tenantId: f.tenant.tenantId, scopeId: invalidGroup }));
    const membership = await f.owner.call(`${base(f.target)}/members`, 'PUT', {
      userId: f.member.actor.principal.id,
      active: false,
    });

    expect(denied.status).toBe(403);
    expect(membership.status).toBe(403);
  });

  it('rechecks record rules even for an exact previously authorized retry', async () => {
    const f = await fixture();

    await grant(f, 'editor');

    const saved = await f.owner.call(collection(f.target), 'POST', mutation('Synthetic collaborative', 'scope'));
    const update = {
      kind: 'update',
      operationId: createOperationId(globalThis.crypto),
      id: saved.body.id,
      expectedRevision: 1,
      title: 'Synthetic collaboration',
      body: 'Synthetic revision',
      audience: 'scope',
    };
    const first = await f.member.call(collection(f.target), 'POST', update);

    expect(first.status).toBe(200);
    const hidden = await f.owner.call(collection(f.target), 'POST', {
      ...update,
      operationId: createOperationId(globalThis.crypto),
      expectedRevision: 2,
      audience: 'owner',
    });

    expect(hidden.status).toBe(200);
    const retry = await f.member.call(collection(f.target), 'POST', update);

    expect(retry.status).toBe(404);
  });
  it('requires verified initialized sessions, Origin/CSRF and strict inputs; never reflects raw input', async () => {
    const anonymous = await fetch(`${origin}/persistence/tenants`, { method: 'POST' });

    expect(anonymous.status).toBe(401);
    const owner = await client();

    const response4 = await owner.call('/persistence/tenants', 'POST', {}, { origin: 'https://wrong.example.test' });

    expect(response4.status).toBe(403);
    const response5 = await owner.call('/persistence/tenants', 'POST', {}, { 'x-csrf-token': 'invalid' });

    expect(response5.status).toBe(403);
    const invalid = await owner.call('/persistence/tenants', 'POST', { plaintext: 'synthetic-private-marker' });

    expect(invalid.status).toBe(400);
    expect(JSON.stringify(invalid.body)).not.toContain('synthetic-private-marker');
    expect(invalid.cache).toBe('no-store');
    const f = await fixture();

    const response6 = await f.owner.call(collection(f.target), 'POST', {
      ...mutation(),
      ownerId: f.member.actor.principal.id,
    });

    expect(response6.status).toBe(400);
    const response7 = await f.owner.call(`${collection(f.target)}?limit=0`);

    expect(response7.status).toBe(400);
    const response8 = await f.owner.call(`${base(f.target)}/children`, 'POST', { kind: 'resource' });

    expect(response8.status).toBe(400);
    const response9 = await f.owner.call(`${base(f.group)}/children`, 'POST', { kind: 'group' });

    expect(response9.status).toBe(400);
  });

  it('denies membership-only access, inherits roles and applies explicit child blocks', async () => {
    const f = await fixture();

    const response10 = await f.member.call(collection(f.target));

    expect(response10.status).toBe(403);

    await grant(f, 'viewer', f.group);

    const response11 = await f.member.call(collection(f.target));

    expect(response11.status).toBe(200);
    const response12 = await f.member.call(collection(f.target), 'POST', mutation());

    expect(response12.status).toBe(403);

    await grant(f, 'blocked');

    const response13 = await f.member.call(collection(f.target));

    expect(response13.status).toBe(403);
    const response14 = await f.outsider.call(collection(f.target));

    expect(response14.status).toBe(403);
  });

  it('enforces the same tenant/scope/record predicates on reads, lists, search and export', async () => {
    const f = await fixture();

    await grant(f, 'viewer');

    const hidden = await f.owner.call(collection(f.target), 'POST', mutation('Synthetic hidden'));
    const shared = await f.owner.call(collection(f.target), 'POST', mutation('Synthetic shared', 'scope'));

    expect(hidden.status).toBe(200);
    expect(shared.status).toBe(200);
    const response15 = await f.member.call(`${collection(f.target)}/${hidden.body.id}`);

    expect(response15.status).toBe(404);
    const response16 = await f.member.call(`${collection(f.target)}/${shared.body.id}`);

    expect(response16.status).toBe(200);

    for (const suffix of ['', '?search=hidden', '/export']) {
      const response = await f.member.call(collection(f.target) + suffix);

      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain('Synthetic hidden');
      expect(JSON.stringify(response.body)).not.toContain(f.owner.actor.principal.id);
    }

    const other = await f.owner.call('/persistence/tenants', 'POST', {});
    const wrong = { ...f.target, tenantId: other.body.tenantId };

    const response17 = await f.owner.call(collection(wrong));

    expect(response17.status).toBe(403);
    const response18 = await f.owner.call(`${collection(f.group)}/${shared.body.id}`);

    expect(response18.status).toBe(403);
    const response19 = await f.outsider.call(`${collection(f.target)}/export`);

    expect(response19.status).toBe(403);
    const response20 = await f.member.call(`${collection(f.target)}/${shared.body.id}`, 'GET');

    expect(response20.body).toEqual(expect.objectContaining({ revision: 1, title: 'Synthetic shared' }));
  });

  it('limits editor writes, sharing and membership/grant management independently', async () => {
    const f = await fixture();

    await grant(f, 'editor');

    const created = await f.member.call(collection(f.target), 'POST', mutation());

    expect(created.status).toBe(200);
    const response21 = await f.member.call(collection(f.target), 'POST', mutation('Synthetic share', 'scope'));

    expect(response21.status).toBe(403);
    const response22 = await f.member.call(`${base(f.target)}/grants`, 'PUT', {
      userId: f.outsider.actor.principal.id,
      role: 'manager',
    });

    expect(response22.status).toBe(403);
    const response23 = await f.member.call(`${base(f.tenant)}/members`, 'PUT', {
      userId: f.outsider.actor.principal.id,
      active: true,
    });

    expect(response23.status).toBe(403);

    await grant(f, 'manager');

    const response24 = await f.member.call(`${base(f.target)}/grants`, 'PUT', {
      userId: f.member.actor.principal.id,
      role: 'manager',
    });

    expect(response24.status).toBe(403);
    const response25 = await f.owner.call(`${base(f.tenant)}/members`, 'PUT', {
      userId: f.owner.actor.principal.id,
      active: false,
    });

    expect(response25.status).toBe(409);
    const response26 = await f.owner.call(`${base(f.tenant)}/members`, 'PUT', { userId: randomUUID(), active: true });

    expect(response26.status).toBe(400);
  });

  it('serializes CAS writes and exact idempotent retries without partial state', async () => {
    const f = await fixture();
    const initial = mutation();
    const [first, retry] = await Promise.all([
      f.owner.call(collection(f.target), 'POST', initial),
      f.owner.call(collection(f.target), 'POST', initial),
    ]);

    expect(first.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    const response27 = await f.owner.call(collection(f.target), 'POST', { ...initial, title: 'Different retry' });

    expect(response27.status).toBe(409);
    const replace = {
      kind: 'update',
      id: first.body.id,
      expectedRevision: 1,
      title: 'Synthetic replacement',
      body: 'Synthetic updated',
      audience: 'owner',
    };
    const results = await Promise.all([
      f.owner.call(collection(f.target), 'POST', { ...replace, operationId: createOperationId(globalThis.crypto) }),
      f.owner.call(collection(f.target), 'POST', { ...replace, operationId: createOperationId(globalThis.crypto) }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const record = await f.owner.call(`${collection(f.target)}/${first.body.id}`);

    expect(record.body.revision).toBe(2);
    const [count] = await resource.db
      .select({ count: sql<number>`count(*)::integer` })
      .from(persistenceSchema.records)
      .where(eq(persistenceSchema.records.tenantId, f.target.tenantId));

    expect(count.count).toBe(1);
  });

  it('revokes effective access on every entry point and never revives old grants on rejoin', async () => {
    const f = await fixture();

    await grant(f, 'manager');

    const record = await f.member.call(collection(f.target), 'POST', mutation());

    expect(record.status).toBe(200);
    const response28 = await f.owner.call(`${base(f.tenant)}/members`, 'PUT', {
      userId: f.member.actor.principal.id,
      active: false,
    });

    expect(response28.status).toBe(200);

    for (const suffix of ['', '?search=Synthetic', '/export', `/${record.body.id}`]) {
      const response29 = await f.member.call(collection(f.target) + suffix);

      expect(response29.status).toBe(403);
    }

    const response30 = await f.member.call(collection(f.target), 'POST', mutation());

    expect(response30.status).toBe(403);
    const response31 = await f.owner.call(`${base(f.tenant)}/members`, 'PUT', {
      userId: f.member.actor.principal.id,
      active: true,
    });

    expect(response31.status).toBe(200);
    const response32 = await f.member.call(collection(f.target));

    expect(response32.status).toBe(403);
  });

  it('rejects ZK content in the SaaS adapter and refuses changed policies without a migration', async () => {
    const f = await fixture();

    const response33 = await f.owner.call(collection(f.target, 'private-resources'), 'POST', mutation());

    expect(response33.status).toBe(409);
    const response34 = await f.owner.call(collection(f.target, 'unknown'));

    expect(response34.status).toBe(409);
    const changed = structuredClone(policy);

    changed.domains[0].retention.activeDays = 91;
    const adapter = new SaasRecords(new Access(resource.db, changed));

    await expect(adapter.list(f.owner.actor, f.target, 'operations', { limit: 25 })).rejects.toMatchObject({
      code: 'policy_migration_required',
    });
  });

  it('soft deletes with a durable revision, scrubs active content and replays exact deletes', async () => {
    const f = await fixture();
    const first = await f.owner.call(collection(f.target), 'POST', mutation('Synthetic removable'));
    const remove = {
      kind: 'delete',
      operationId: createOperationId(globalThis.crypto),
      id: first.body.id,
      expectedRevision: 1,
    };
    const result = await f.owner.call(collection(f.target), 'POST', remove);

    expect(result.body).toEqual({ id: first.body.id, revision: 2, deleted: true });
    const response35 = await f.owner.call(collection(f.target), 'POST', remove);

    expect(response35.body).toEqual(result.body);
    const response36 = await f.owner.call(`${collection(f.target)}/${first.body.id}`);

    expect(response36.status).toBe(404);
    const [stored] = await resource.db
      .select()
      .from(persistenceSchema.records)
      .where(
        and(eq(persistenceSchema.records.tenantId, f.target.tenantId), eq(persistenceSchema.records.id, first.body.id)),
      );

    expect(stored.title).toBe('');
    expect(stored.body).toBe('');
    expect(stored.deletedAt).toBeInstanceOf(Date);
    const response37 = await f.owner.call(collection(f.target), 'POST', {
      ...remove,
      kind: 'update',
      operationId: createOperationId(globalThis.crypto),
      title: 'Old restored',
      body: '',
      audience: 'owner',
    });

    expect(response37.status).toBe(404);
  });

  it('paginates authorized records, escapes search wildcards and applies age limits', async () => {
    const f = await fixture();

    for (const name of ['Synthetic 100%', 'Synthetic ordinary', 'Synthetic old']) {
      const response38 = await f.owner.call(collection(f.target), 'POST', mutation(name));

      expect(response38.status).toBe(200);
    }

    const first = await f.owner.call(`${collection(f.target)}?limit=1`);
    const second = await f.owner.call(`${collection(f.target)}?limit=1&after=${first.body.next}`);

    expect(first.body.items).toHaveLength(1);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    const response39 = await f.owner.call(`${collection(f.target)}?search=%25`);

    expect(response39.body.items).toHaveLength(1);

    await resource.db
      .update(persistenceSchema.records)
      .set({ createdAt: new Date(Date.now() - 91 * 86_400_000) })
      .where(
        and(
          eq(persistenceSchema.records.tenantId, f.target.tenantId),
          eq(persistenceSchema.records.title, 'Synthetic old'),
        ),
      );

    const response40 = await f.owner.call(collection(f.target));

    expect(response40.body.items).toHaveLength(2);
  });

  it('rechecks identity and session binding inside the transaction', async () => {
    const f = await fixture();
    const access = new Access(resource.db, policy);

    await expect(
      access.withScope({ ...f.owner.actor, sessionId: f.outsider.actor.sessionId }, f.target, 'read', async () => true),
    ).rejects.toMatchObject({ code: 'authentication_required' });

    await resource.db
      .update(authSchema.users)
      .set({ authVersion: 2 })
      .where(eq(authSchema.users.id, f.owner.actor.principal.id));

    const response41 = await f.owner.call(collection(f.target));

    expect(response41.status).toBe(401);
  });

  it('enforces composite tenant foreign keys and survives reconnect without in-memory authorization state', async () => {
    const f = await fixture();
    const another = await f.owner.call('/persistence/tenants', 'POST', {});

    await expect(
      resource.db.insert(persistenceSchema.grants).values({
        tenantId: another.body.tenantId,
        scopeId: f.target.scopeId,
        userId: f.member.actor.principal.id,
        role: 'viewer',
      }),
    ).rejects.toThrow();

    const saved = await f.owner.call(collection(f.target), 'POST', mutation());
    const independent = createDatabase(postgres.url);

    try {
      const adapter = new SaasRecords(new Access(independent.db, policy));

      await expect(adapter.read(f.owner.actor, f.target, 'operations', saved.body.id)).resolves.toMatchObject({
        revision: 1,
      });
    } finally {
      await independent.close();
    }
  });

  it('rolls back quota failures, checks search capabilities and isolates the composed manifest from callers', async () => {
    const owner = await client();
    const limited = structuredClone(policy);

    limited.domains[0].quotas.maxUnits = 1;
    limited.domains[0].quotas.maxScopeBytes = 30;
    limited.domains[0].quotas.maxUnitBytes = 30;
    limited.domains[0].retention.activeDays = null;
    limited.domains[0].serverProcessing.search = false;
    // Use a larger unit envelope limit after validating a narrow byte limit below.
    const narrow = new Access(resource.db, limited);
    const narrowTenant = await narrow.createTenant(owner.actor);
    const narrowTarget = await narrow.createScope(owner.actor, narrowTenant, { kind: 'resource' });
    const narrowRecords = new SaasRecords(narrow);

    await expect(narrowRecords.mutate(owner.actor, narrowTarget, 'operations', mutation())).rejects.toMatchObject({
      code: 'quota_exceeded',
    });

    limited.domains[0].quotas.maxScopeBytes = 1000;
    limited.domains[0].quotas.maxUnitBytes = 1000;
    const access = new Access(resource.db, limited);
    const tenant = await access.createTenant(owner.actor);
    const target = await access.createScope(owner.actor, tenant, { kind: 'resource' });
    const adapter = new SaasRecords(access);
    const saved = await adapter.mutate(owner.actor, target, 'operations', mutation());

    await expect(adapter.mutate(owner.actor, target, 'operations', mutation())).rejects.toMatchObject({
      code: 'quota_exceeded',
    });

    await expect(
      adapter.list(owner.actor, target, 'operations', { limit: 25, search: 'Synthetic' }),
    ).rejects.toMatchObject({ code: 'capability_unavailable' });

    const outside = access.policy;

    outside.domains[0].serverProcessing.search = true;
    expect(access.policy.domains[0].serverProcessing.search).toBe(false);
    const read = await adapter.read(owner.actor, target, 'operations', saved.id);

    expect(read.revision).toBe(1);
    const page = await adapter.list(owner.actor, target, 'operations', { limit: 25 });

    expect(page.items).toHaveLength(1);
  });

  it('restores an actual isolated SQL backup with ACLs, revisions, idempotency and tombstones intact', async () => {
    const f = await fixture();
    const created = await f.owner.call(collection(f.target), 'POST', mutation('Synthetic backup record'));
    const removed = await f.owner.call(collection(f.target), 'POST', mutation('Synthetic backup tombstone'));
    const remove = {
      kind: 'delete',
      operationId: createOperationId(globalThis.crypto),
      id: removed.body.id,
      expectedRevision: 1,
    };
    const deleted = await f.owner.call(collection(f.target), 'POST', remove);

    expect(created.status).toBe(200);
    expect(deleted.status).toBe(200);
    const backup = '/tmp/synthetic-persistence-backup.sql';

    // Use the owned container's matching clients instead of a host CLI dependency.
    await runTestCompose(postgres.compose, [
      'exec',
      '-T',
      'postgres',
      'pg_dump',
      '--username',
      'visomi_test',
      '--dbname',
      'visomi_auth_test',
      '--no-owner',
      '--no-privileges',
      '--file',
      backup,
    ]);

    const dump = await runTestCompose(postgres.compose, ['exec', '-T', 'postgres', 'cat', backup]);
    const contents = dump.stdout;

    expect(contents).toContain('persistence_records');
    expect(contents).toContain('Synthetic backup record');
    expect(contents).not.toContain('Synthetic backup tombstone');

    await resource.pool.query('CREATE DATABASE visomi_persistence_restore_test');

    const restoredUrl = new URL(postgres.url);

    restoredUrl.pathname = '/visomi_persistence_restore_test';

    await runTestCompose(postgres.compose, [
      'exec',
      '-T',
      'postgres',
      'psql',
      '--username',
      'visomi_test',
      '--dbname',
      'visomi_persistence_restore_test',
      '--set',
      'ON_ERROR_STOP=1',
      '--file',
      backup,
    ]);

    const restored = createDatabase(restoredUrl.toString());

    try {
      const adapter = new SaasRecords(new Access(restored.db, policy));
      const record = await adapter.read(f.owner.actor, f.target, 'operations', created.body.id);

      expect(record.revision).toBe(1);

      await expect(adapter.read(f.outsider.actor, f.target, 'operations', created.body.id)).rejects.toMatchObject({
        code: 'scope_access_denied',
      });

      await expect(adapter.read(f.owner.actor, f.target, 'operations', removed.body.id)).rejects.toMatchObject({
        code: 'record_unavailable',
      });

      const retry = await adapter.mutate(f.owner.actor, f.target, 'operations', remove);

      expect(retry).toEqual(deleted.body);
    } finally {
      await restored.close();
    }
  }, 60_000);
});
