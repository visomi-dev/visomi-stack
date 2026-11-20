import { randomUUID } from 'node:crypto';

import { vaultSchema } from '@visomi-stack/backend-db';
import { dataEnvelopeSchema, deviceProofSchema, syncHeadSchema } from '@visomi-stack/shared-db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { base, fixture, grant, resource } from './support/persistence';
import { authorize, boot, deliver, identity, push, request, vaultBase } from './support/vault';

describe('opaque persistence and key lifecycle over authenticated HTTP and PostgreSQL', () => {
  it('requires a scope role and possession proof; bootstrap is single-use and cannot replace initialized keys', async () => {
    const f = await fixture();

    await expect(
      f.owner.call(`${base(f.tenant)}/children`, 'POST', { kind: 'resource', objectBackup: true }),
    ).resolves.toMatchObject({ status: 503 });

    const device = identity();
    const denied = await f.member.call(`${vaultBase(f.target)}/devices/request`, 'POST', {
      deviceId: device.id,
      keys: device.keys,
    });

    expect(denied.status).toBe(403);
    const proof = await boot(f, device);
    const replay = await f.owner.call(`${vaultBase(f.target)}/devices/bootstrap`, 'POST', proof);

    expect(replay.status).toBe(400);
    const next = await request(f.owner, f.target, identity());
    const replace = await f.owner.call(`${vaultBase(f.target)}/devices/bootstrap`, 'POST', next);

    expect(replace.status).toBe(409);
    const roster = await f.owner.call(`${vaultBase(f.target)}/devices`);

    expect(roster.status).toBe(200);
    expect(roster.body).toMatchObject({ epoch: 1, devices: [{ id: device.id }] });
    const empty = await f.owner.call(`${vaultBase(f.target)}/sync/pull`, 'POST', {
      protocol: 1,
      head: { cursor: 0, checkpoint: null },
    });

    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ events: [], more: false, head: { cursor: 0, checkpoint: null } });
  });

  it('burns failed and expired challenges and rejects context substitution', async () => {
    const f = await fixture();
    const proof = await request(f.owner, f.target, identity());
    const invalid = await f.owner.call(`${vaultBase(f.target)}/devices/bootstrap`, 'POST', {
      ...proof,
      proof: Buffer.alloc(64).toString('base64url'),
    });

    expect(invalid.status).toBe(400);
    const replay = await f.owner.call(`${vaultBase(f.target)}/devices/bootstrap`, 'POST', proof);

    expect(replay.status).toBe(400);
    const expired = await request(f.owner, f.target, identity());

    await resource.db
      .update(vaultSchema.keyChallenges)
      .set({ expiresAt: new Date(0) })
      .where(eq(vaultSchema.keyChallenges.id, expired.requestId));

    const late = await f.owner.call(`${vaultBase(f.target)}/devices/bootstrap`, 'POST', expired);

    expect(late.status).toBe(400);
    const changed = await request(f.owner, f.target, identity());
    const substitution = await f.owner.call(`${vaultBase(f.target)}/devices/bootstrap`, 'POST', {
      ...changed,
      deviceId: randomUUID(),
    });

    expect(substitution.status).toBe(400);
  });

  it('requires existing device approval and binds delivery to the proved recipient', async () => {
    const f = await fixture();

    await grant(f, 'manager');

    const first = identity();
    const key = await boot(f, first);
    const second = identity();
    const proof = await request(f.member, f.target, second);
    const delivery = deliver(proof);
    const body = { proof, delivery };
    const noAuthority = await f.member.call(`${vaultBase(f.target)}/devices/approve`, 'POST', {
      ...body,
      authorization: authorize(second, key.key, 1, 'approve', body),
    });

    expect(noAuthority.status).toBe(403);
    // Failed approvals consume the challenge; a fresh possession proof is required.
    const fresh = await request(f.member, f.target, second);
    const approvedBody = { proof: fresh, delivery: deliver(fresh) };
    const approved = await f.owner.call(`${vaultBase(f.target)}/devices/approve`, 'POST', {
      ...approvedBody,
      authorization: authorize(first, key.key, 1, 'approve', approvedBody),
    });

    expect(approved.status).toBe(200);
    const fetched = await f.member.call(`${vaultBase(f.target)}/devices/${second.id}/delivery`);

    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({
      delivery: approvedBody.delivery,
      witness: { kind: 'enrollment', proof: fresh },
    });
    const wrongOwner = await f.owner.call(`${vaultBase(f.target)}/devices/${second.id}/delivery`);

    expect(wrongOwner.status).toBe(404);
    const another = await request(f.member, f.target, identity());
    const wrong = { proof: another, delivery: deliver(another) };

    wrong.delivery.binding.ownerId = f.owner.actor.principal.id;
    const replaced = await f.owner.call(`${vaultBase(f.target)}/devices/approve`, 'POST', {
      ...wrong,
      authorization: authorize(first, key.key, 2, 'approve', wrong),
    });

    expect(replaced.status).toBe(400);
  });

  it('serializes ciphertext writes, exact retries, conflicts, paging, rollback and propagated tombstones', async () => {
    const f = await fixture();
    const first = identity();
    const key = await boot(f, first);
    const value = push(first, key);
    const path = `${vaultBase(f.target)}/sync`;
    const writes = await Promise.all([
      f.owner.call(`${path}/push`, 'POST', value),
      f.owner.call(`${path}/push`, 'POST', value),
    ]);

    expect(writes.map((item) => item.status)).toEqual([200, 200]);
    expect(writes[0].body).toEqual(writes[1].body);
    const head = syncHeadSchema.parse(writes[0].body);
    const stale = await f.owner.call(`${path}/push`, 'POST', push(first, key));

    expect(stale.status).toBe(409);
    const tombstone = push(first, key, head, 1, 2, value.envelope.context.objectId, 'tombstone');
    const deleted = await f.owner.call(`${path}/push`, 'POST', tombstone);

    expect(deleted.status).toBe(200);
    const page = await f.owner.call(`${path}/pull`, 'POST', {
      protocol: 1,
      head: { cursor: 0, checkpoint: null },
      limit: 1,
    });

    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ more: true, events: [{ cursor: 1 }] });
    const next = await f.owner.call(`${path}/pull`, 'POST', { protocol: 1, head });

    expect(next.body).toMatchObject({
      more: false,
      events: [{ cursor: 2, envelope: { context: { kind: 'tombstone' } } }],
    });
    const rollback = await f.owner.call(`${path}/pull`, 'POST', {
      protocol: 1,
      head: { cursor: 3, checkpoint: head.checkpoint },
    });

    expect(rollback.status).toBe(409);
    const forged = await f.owner.call(`${path}/pull`, 'POST', {
      protocol: 1,
      head: { cursor: 1, checkpoint: Buffer.alloc(32).toString('base64url') },
    });

    expect(forged.status).toBe(409);
    const [stored] = await resource.db
      .select()
      .from(vaultSchema.opaqueUnits)
      .where(eq(vaultSchema.opaqueUnits.id, value.envelope.context.objectId));

    expect(JSON.stringify(stored)).not.toContain('Synthetic secret payload');
    expect(dataEnvelopeSchema.parse(stored.envelope).context.kind).toBe('tombstone');
  });

  it('blocks old generations throughout an interrupted rotation and commits all deliveries atomically', async () => {
    const f = await fixture();
    const first = identity();
    const key = await boot(f, first);
    const second = identity();
    const proof = await request(f.owner, f.target, second);
    const approval = { proof, delivery: deliver(proof) };
    const added = await f.owner.call(`${vaultBase(f.target)}/devices/approve`, 'POST', {
      ...approval,
      authorization: authorize(first, key.key, 1, 'approve', approval),
    });

    expect(added.status).toBe(200);
    const revoke = { deviceId: second.id };
    const revoked = await f.owner.call(`${vaultBase(f.target)}/devices/revoke`, 'POST', {
      ...revoke,
      authorization: authorize(first, key.key, 2, 'revoke', revoke),
    });

    expect(revoked.status).toBe(200);
    const offline = await f.owner.call(`${vaultBase(f.target)}/sync/push`, 'POST', push(second, key, undefined, 3));

    expect(offline.status).toBe(409);
    const incomplete = { deliveries: [deliver(proof, 2)] };
    const failed = await f.owner.call(`${vaultBase(f.target)}/devices/rotate`, 'POST', {
      ...incomplete,
      authorization: authorize(first, key.key, 3, 'rotate', incomplete),
    });

    expect(failed.status).toBe(409);
    const roster = await f.owner.call(`${vaultBase(f.target)}/devices`);

    expect(roster.body).toMatchObject({ phase: 'rotating', key: { generation: 1 }, epoch: 3 });
    const complete = { deliveries: [deliver(key, 2, Buffer.alloc(32, 9))] };
    const rotated = await f.owner.call(`${vaultBase(f.target)}/devices/rotate`, 'POST', {
      ...complete,
      authorization: authorize(first, key.key, 3, 'rotate', complete),
    });

    expect(rotated.status).toBe(200);
    const stale = await f.owner.call(`${vaultBase(f.target)}/sync/push`, 'POST', push(first, key, undefined, 4));

    expect(stale.status).toBe(409);
    const fresh = await f.owner.call(
      `${vaultBase(f.target)}/sync/push`,
      'POST',
      push(first, key, undefined, 4, 1, randomUUID(), 'record', 2, undefined, Buffer.alloc(32, 9)),
    );

    expect(fresh.status).toBe(200);
    const replay = await f.owner.call(`${vaultBase(f.target)}/devices/rotate`, 'POST', {
      ...complete,
      authorization: authorize(first, key.key, 3, 'rotate', complete),
    });

    expect(replay.status).toBe(409);
  });

  it('invalidates key devices on membership and role changes and never resurrects them on rejoin', async () => {
    const f = await fixture();

    await grant(f, 'manager');

    const first = identity();
    const key = await boot(f, first);
    const second = identity();
    const proof = await request(f.member, f.target, second);
    const approval = { proof, delivery: deliver(proof) };
    const approved = await f.owner.call(`${vaultBase(f.target)}/devices/approve`, 'POST', {
      ...approval,
      authorization: authorize(first, key.key, 1, 'approve', approval),
    });

    expect(approved.status).toBe(200);

    await grant(f, 'blocked');

    const denied = await f.member.call(`${vaultBase(f.target)}/devices/${second.id}/delivery`);

    expect(denied.status).toBe(403);

    await grant(f, 'manager');

    const old = await f.member.call(`${vaultBase(f.target)}/devices/${second.id}/delivery`);

    expect(old.status).toBe(404);
    const [registry] = await resource.db
      .select()
      .from(vaultSchema.keyScopes)
      .where(
        and(eq(vaultSchema.keyScopes.tenantId, f.target.tenantId), eq(vaultSchema.keyScopes.scopeId, f.target.scopeId)),
      );

    expect(registry.phase).toBe('rotating');
    const remove = await f.owner.call(`${base(f.tenant)}/members`, 'PUT', {
      userId: f.member.actor.principal.id,
      active: false,
    });

    expect(remove.status).toBe(200);
    expect(deviceProofSchema.safeParse(proof).success).toBe(true);
  });
});
