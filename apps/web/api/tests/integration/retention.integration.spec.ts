import { randomUUID } from 'node:crypto';

import { persistenceSchema, vaultSchema } from '@visomi-stack/backend-shared';
import { createOperationId, operationWindowMs, retentionDayMs, type SyncHead } from '@visomi-stack/shared-persistence';
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { Access } from '../../src/access/service';
import { PersistenceMaintenance } from '../../src/persistence/maintenance';
import { SaasRecords } from '../../src/persistence/records';

import { base, collection, fixture, grant, mutation, policy, resource } from './support/persistence';
import { authorize, boot, identity, push, request, vaultBase } from './support/vault';

const { records, commands } = persistenceSchema;
const { opaqueEvents: events, opaqueUnits: units, opaqueStreams: streams, opaqueCommands, keyChallenges } = vaultSchema;
const ago = (days: number) => new Date(Date.now() - days * retentionDayMs);
const maintainPath = (f: Awaited<ReturnType<typeof fixture>>, domain = 'operations') =>
  `${base(f.target)}/domains/${domain}/maintenance`;
const scoped = (table: typeof events | typeof units | typeof streams, f: Awaited<ReturnType<typeof fixture>>) =>
  and(eq(table.tenantId, f.target.tenantId), eq(table.scopeId, f.target.scopeId));

describe('explicit bounded persistence retention', () => {
  it('requires current owner authority, rejects overrides and leaves fresh records readable', async () => {
    const f = await fixture();

    await grant(f, 'manager');

    const record = await f.owner.call(collection(f.target), 'POST', mutation());
    const denied = await f.member.call(maintainPath(f), 'POST', { limit: 10 });
    const outsider = await f.outsider.call(maintainPath(f), 'POST', { limit: 10 });
    const invalid = await f.owner.call(maintainPath(f), 'POST', { limit: 101, now: Date.now() });
    const wrongScope = await f.owner.call(`${base(f.group)}/domains/operations/maintenance`, 'POST', { limit: 1 });
    const unknown = await f.owner.call(maintainPath(f, 'missing-domain'), 'POST', { limit: 1 });
    const result = await f.owner.call(maintainPath(f), 'POST', { limit: 1 });
    const current = await f.owner.call(`${collection(f.target)}/${record.body.id}`);

    expect([denied.status, outsider.status, wrongScope.status]).toEqual([403, 403, 403]);
    expect(invalid.status).toBe(400);
    expect(unknown.status).toBe(409);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ receipts: 0, scrubbed: 0, purged: 0, events: 0, tombstones: 0, challenges: 0 });
    expect(result.cache).toBe('no-store');
    expect(current.body.id).toBe(record.body.id);
  });

  it('scrubs active-age content, honors grace and bounds physical purge without crossing scope/domain', async () => {
    const f = await fixture();
    const custom = structuredClone(policy);

    custom.domains[0].retention.activeDays = 1;
    custom.domains[0].retention.deletionGraceDays = 2;
    const access = new Access(resource.db, custom);
    const tenant = await access.createTenant(f.owner.actor);
    const target = await access.createScope(f.owner.actor, tenant, { kind: 'resource' });
    const adapter = new SaasRecords(access);
    const maintenance = new PersistenceMaintenance(access);
    const old = await adapter.mutate(f.owner.actor, target, 'operations', mutation());
    const grace = await adapter.mutate(f.owner.actor, target, 'operations', mutation());
    const fresh = await adapter.mutate(f.owner.actor, target, 'operations', mutation());
    const unrelated = await f.owner.call(collection(f.target), 'POST', mutation());

    await resource.db
      .update(records)
      .set({ createdAt: ago(4) })
      .where(eq(records.id, old.id));

    await resource.db
      .update(records)
      .set({ createdAt: ago(2) })
      .where(eq(records.id, grace.id));

    await resource.db
      .update(records)
      .set({ createdAt: ago(100) })
      .where(eq(records.id, unrelated.body.id));

    const first = await maintenance.run(f.owner.actor, target, 'operations', { limit: 1 });
    const second = await maintenance.run(f.owner.actor, target, 'operations', { limit: 1 });
    const rows = await resource.db.select().from(records).where(eq(records.tenantId, target.tenantId));

    expect(first).toMatchObject({ scrubbed: 1, purged: 1 });
    expect(second).toMatchObject({ scrubbed: 1, purged: 0 });
    expect(rows.map((row) => row.id).sort()).toEqual([grace.id, fresh.id].sort());
    expect(rows.find((row) => row.id === grace.id)).toMatchObject({ title: '', body: '', deletedAt: expect.any(Date) });
    const [other] = await resource.db.select().from(records).where(eq(records.id, unrelated.body.id));

    expect(other.body).toBe('Synthetic server-readable content');

    await expect(adapter.read(f.owner.actor, target, 'operations', grace.id)).rejects.toMatchObject({
      code: 'record_unavailable',
    });

    const nullPolicy = structuredClone(policy);

    nullPolicy.domains[0].retention.activeDays = null;
    const nullAccess = new Access(resource.db, nullPolicy);
    const nullTenant = await nullAccess.createTenant(f.owner.actor);
    const nullTarget = await nullAccess.createScope(f.owner.actor, nullTenant, { kind: 'resource' });
    const unchanged = await new PersistenceMaintenance(nullAccess).run(f.owner.actor, nullTarget, 'operations', {
      limit: 1,
    });

    expect(unchanged.scrubbed).toBe(0);
  });

  it('expires SaaS receipts without reexecuting expired/future commands or changing a live exact retry', async () => {
    const f = await fixture();
    const body = mutation();
    const first = await f.owner.call(collection(f.target), 'POST', body);
    const oldId = createOperationId(globalThis.crypto, ago(31).getTime());

    await resource.db.insert(commands).values({
      tenantId: f.target.tenantId,
      scopeId: f.target.scopeId,
      domain: 'operations',
      userId: f.owner.actor.principal.id,
      operationId: oldId,
      fingerprint: 'synthetic-old-fingerprint',
      result: { id: first.body.id, revision: 1, deleted: false },
      createdAt: ago(31),
    });

    const result = await f.owner.call(maintainPath(f), 'POST', { limit: 1 });
    const expired = await f.owner.call(collection(f.target), 'POST', { ...body, operationId: oldId });
    const future = await f.owner.call(collection(f.target), 'POST', {
      ...body,
      operationId: createOperationId(globalThis.crypto, Date.now() + 600_000),
    });
    const legacy = await f.owner.call(collection(f.target), 'POST', { ...body, operationId: randomUUID() });
    const retry = await f.owner.call(collection(f.target), 'POST', body);
    const rows = await resource.db.select().from(commands).where(eq(commands.tenantId, f.target.tenantId));

    expect(result.body).toMatchObject({ receipts: 1 });
    expect(expired.status).toBe(409);
    expect(future.status).toBe(409);
    expect(expired.body).toEqual({ error: 'operation_expired' });
    expect(legacy.status).toBe(400);
    expect(retry.body).toEqual(first.body);
    expect(rows.map((row) => row.operationId)).toEqual([body.operationId]);
    const page = await f.owner.call(collection(f.target));

    expect(page.body.items).toHaveLength(1);
  });

  it('does not execute cloud maintenance for a local-only domain', async () => {
    const f = await fixture();
    const local = structuredClone(policy);

    Object.assign(local.domains[1], { location: 'local', visibleMetadata: [] });
    local.domains[1].retention.cloudBackupDays = 0;

    await expect(
      new PersistenceMaintenance(new Access(resource.db, local)).run(f.owner.actor, f.target, 'private-resources', {
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: 'domain_adapter_incompatible' });
  });

  it('expires consumed/unused challenges before a stream exists and retains unexpired ones', async () => {
    const f = await fixture();
    const uninitialized = await request(f.owner, f.target, identity());

    await resource.db
      .update(keyChallenges)
      .set({ expiresAt: ago(1) })
      .where(eq(keyChallenges.id, uninitialized.requestId));

    const beforeBootstrap = await f.owner.call(maintainPath(f, 'private-resources'), 'POST', { limit: 1 });
    const registries = await resource.db
      .select()
      .from(vaultSchema.keyScopes)
      .where(eq(vaultSchema.keyScopes.tenantId, f.target.tenantId));

    expect(beforeBootstrap.body).toMatchObject({ challenges: 1 });
    expect(registries).toHaveLength(0);
    const device = identity();
    const proof = await boot(f, device);

    await request(f.owner, f.target, identity());

    await resource.db
      .update(keyChallenges)
      .set({ expiresAt: ago(1) })
      .where(eq(keyChallenges.id, proof.requestId));

    const result = await f.owner.call(maintainPath(f, 'private-resources'), 'POST', { limit: 1 });
    const remaining = await resource.db
      .select()
      .from(keyChallenges)
      .where(eq(keyChallenges.tenantId, f.target.tenantId));

    expect(result.body).toMatchObject({ challenges: 1, events: 0, tombstones: 0 });
    expect(remaining).toHaveLength(1);
  });

  it('compacts old history atomically, scrubs expired tombstone ciphertext and preserves revision fences', async () => {
    const f = await fixture();
    const device = identity();
    const proof = await boot(f, device);
    const path = `${vaultBase(f.target)}/sync`;
    const one = push(device, proof);
    const first = await f.owner.call(`${path}/push`, 'POST', one);
    const second = await f.owner.call(
      `${path}/push`,
      'POST',
      push(device, proof, first.body as unknown as SyncHead, 1, 2, one.envelope.context.objectId, 'tombstone'),
    );
    const third = await f.owner.call(`${path}/push`, 'POST', push(device, proof, second.body as unknown as SyncHead));

    expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);

    await resource.db
      .update(events)
      .set({ createdAt: ago(31) })
      .where(and(scoped(events, f), inArray(events.cursor, [1, 2])));

    await resource.db
      .update(units)
      .set({ updatedAt: ago(31) })
      .where(and(scoped(units, f), eq(units.id, one.envelope.context.objectId)));

    const oldOperation = createOperationId(globalThis.crypto, ago(31).getTime());

    await resource.db.insert(opaqueCommands).values({
      tenantId: f.target.tenantId,
      scopeId: f.target.scopeId,
      domain: 'private-resources',
      userId: f.owner.actor.principal.id,
      operationId: oldOperation,
      fingerprint: 'synthetic-old',
      cursor: 1,
      checkpoint: (first.body as unknown as SyncHead).checkpoint!,
      createdAt: ago(31),
    });

    const result = await f.owner.call(maintainPath(f, 'private-resources'), 'POST', { limit: 100 });
    const old = await f.owner.call(`${path}/pull`, 'POST', { protocol: 1, head: first.body });
    const freshClient = await f.owner.call(`${path}/pull`, 'POST', {
      protocol: 1,
      head: { cursor: 0, checkpoint: null },
    });
    const atFloor = await f.owner.call(`${path}/pull`, 'POST', { protocol: 1, head: second.body });
    const wrongFloor = await f.owner.call(`${path}/pull`, 'POST', {
      protocol: 1,
      head: { ...second.body, checkpoint: Buffer.alloc(32, 5).toString('base64url') },
    });
    const rollback = await f.owner.call(`${path}/pull`, 'POST', { protocol: 1, head: { ...third.body, cursor: 4 } });
    const [grave] = await resource.db
      .select()
      .from(units)
      .where(and(scoped(units, f), eq(units.id, one.envelope.context.objectId)));

    expect(result.body).toMatchObject({ receipts: 1, events: 2, tombstones: 1 });
    expect(old.body).toEqual({ error: 'sync_history_expired' });
    expect(freshClient.body).toEqual({ error: 'sync_history_expired' });
    expect(atFloor.status).toBe(200);
    expect(atFloor.body).toMatchObject({ events: [{ cursor: 3 }], more: false });
    expect(wrongFloor.body).toEqual({ error: 'sync_checkpoint_conflict' });
    expect(rollback.body).toEqual({ error: 'sync_rollback_detected' });
    expect(grave).toMatchObject({ revision: 2, tombstone: true, envelope: null, bytes: 0 });
    const stale = await f.owner.call(
      `${path}/push`,
      'POST',
      push(device, proof, third.body as unknown as SyncHead, 1, 1, one.envelope.context.objectId),
    );
    const expired = push(device, proof, third.body as unknown as SyncHead);

    expired.operationId = oldOperation;
    const { authorization: _authorization, ...signedBody } = expired;

    expired.authorization = authorize(device, proof.key, 1, 'sync', signedBody, oldOperation);
    const replay = await f.owner.call(`${path}/push`, 'POST', expired);
    const again = await f.owner.call(maintainPath(f, 'private-resources'), 'POST', { limit: 1 });

    expect(stale.body).toEqual({ error: 'revision_conflict' });
    expect(replay.body).toEqual({ error: 'operation_expired' });
    expect(again.body).toMatchObject({ events: 0, tombstones: 0 });
  });

  it('stops at a fresh event, bounds each prefix and rolls back a corrupt candidate batch', async () => {
    const f = await fixture();
    const device = identity();
    const proof = await boot(f, device);
    const path = `${vaultBase(f.target)}/sync/push`;
    const first = await f.owner.call(path, 'POST', push(device, proof));
    const second = await f.owner.call(path, 'POST', push(device, proof, first.body as unknown as SyncHead));

    await resource.db
      .update(events)
      .set({ createdAt: ago(31) })
      .where(and(scoped(events, f), eq(events.cursor, 2)));

    const stopped = await f.owner.call(maintainPath(f, 'private-resources'), 'POST', { limit: 2 });

    expect(stopped.body).toMatchObject({ events: 0 });

    await resource.db
      .update(events)
      .set({ createdAt: ago(31), previousCheckpoint: 'synthetic-corrupt-checkpoint' })
      .where(and(scoped(events, f), eq(events.cursor, 1)));

    const corrupt = await f.owner.call(maintainPath(f, 'private-resources'), 'POST', { limit: 2 });
    const [before] = await resource.db.select().from(streams).where(scoped(streams, f));

    expect(corrupt.body).toEqual({ error: 'sync_checkpoint_conflict' });
    expect(before.floorCursor).toBe(0);

    await resource.db
      .update(events)
      .set({ previousCheckpoint: null })
      .where(and(scoped(events, f), eq(events.cursor, 1)));

    const [firstEvent] = await resource.db
      .select()
      .from(events)
      .where(and(scoped(events, f), eq(events.cursor, 1)));

    await resource.db.delete(events).where(and(scoped(events, f), eq(events.cursor, 1)));

    const missingCursor = await f.owner.call(maintainPath(f, 'private-resources'), 'POST', { limit: 2 });

    expect(missingCursor.body).toEqual({ error: 'sync_checkpoint_conflict' });

    await resource.db.insert(events).values(firstEvent);

    const limited = await f.owner.call(maintainPath(f, 'private-resources'), 'POST', { limit: 1 });
    const [after] = await resource.db.select().from(streams).where(scoped(streams, f));
    const remaining = await resource.db.select().from(events).where(scoped(events, f));

    expect(limited.body).toMatchObject({ events: 1 });
    expect(after).toMatchObject({ floorCursor: 1, floorCheckpoint: (first.body as unknown as SyncHead).checkpoint });
    expect(remaining.map((row) => row.cursor)).toEqual([2]);
    const last = await f.owner.call(maintainPath(f, 'private-resources'), 'POST', { limit: 1 });
    const final = await f.owner.call(`${vaultBase(f.target)}/sync/pull`, 'POST', { protocol: 1, head: second.body });

    expect(last.body).toMatchObject({ events: 1 });
    expect(final.body).toMatchObject({ events: [], more: false });
    expect(operationWindowMs(policy.domains[1])).toBe(30 * retentionDayMs);
  });
});
