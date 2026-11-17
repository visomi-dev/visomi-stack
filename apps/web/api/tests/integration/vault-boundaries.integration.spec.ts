import { randomUUID } from 'node:crypto';

import { vaultSchema } from '@visomi-stack/backend-db';
import { syncHeadSchema, syntheticHybridPolicy, type ProductPolicy } from '@visomi-stack/shared-db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { Access } from '../../src/access/service';
import { KeyDevices } from '../../src/db/devices';
import { OpaqueSync } from '../../src/db/opaque';

import { base, fixture, grant, resource } from './support/persistence';
import {
  authorize,
  boot,
  deliver,
  domain,
  identity,
  prove,
  push,
  request,
  vaultBase,
  type Identity,
} from './support/vault';

const resign = (device: Identity, value: ReturnType<typeof push>) => {
  const { authorization, ...body } = value;

  return {
    ...body,
    authorization: authorize(
      device,
      authorization.key,
      authorization.epoch,
      authorization.action,
      body,
      body.operationId,
    ),
  };
};

describe('ciphertext API authorization and bounded failure states', () => {
  it('rechecks recipient membership/grants, preserves identical roles and returns only declared policy metadata', async () => {
    const f = await fixture();
    const access = new Access(resource.db, syntheticHybridPolicy);

    await expect(
      access.withScope(f.owner.actor, f.target, 'share', (context) =>
        access.requireRecipient(context, f.outsider.actor.principal.id),
      ),
    ).rejects.toMatchObject({ code: 'scope_access_denied' });

    await expect(
      access.withScope(f.owner.actor, f.target, 'share', (context) =>
        access.requireRecipient(context, f.member.actor.principal.id),
      ),
    ).rejects.toMatchObject({ code: 'scope_access_denied' });

    await grant(f, 'blocked');

    await expect(
      access.withScope(f.owner.actor, f.target, 'share', (context) =>
        access.requireRecipient(context, f.member.actor.principal.id),
      ),
    ).rejects.toMatchObject({ code: 'scope_access_denied' });

    await grant(f, 'manager');

    await grant(f, 'manager');

    const uninitialized = await f.owner.call(`${vaultBase(f.target)}/devices`);

    expect(uninitialized.status).toBe(409);
    const metadata = await f.owner.call('/persistence/policy');

    expect(metadata.status).toBe(200);
    expect(metadata.body).toMatchObject({ policy: syntheticHybridPolicy });
    const unauthorizedBootstrap = await request(f.member, f.target, identity());
    const denied = await f.member.call(`${vaultBase(f.target)}/devices/bootstrap`, 'POST', unauthorizedBootstrap);

    expect(denied.status).toBe(403);
  });

  it('bounds enrollment challenges, rejects unavailable deliveries and keeps rotation barriers during enrollment', async () => {
    const f = await fixture();
    const first = identity();
    const proof = await boot(f, first);
    const future = new Date(Date.now() + 300_000);
    const { proof: _signature, ...challenge } = proof;

    await resource.db.insert(vaultSchema.keyChallenges).values(
      Array.from({ length: 32 }, () => ({
        tenantId: f.target.tenantId,
        scopeId: f.target.scopeId,
        domain,
        id: randomUUID(),
        ownerId: proof.ownerId,
        value: challenge,
        expiresAt: future,
      })),
    );

    const limited = await f.owner.call(`${vaultBase(f.target)}/devices/request`, 'POST', {
      deviceId: first.id,
      keys: first.keys,
    });

    expect(limited.status).toBe(429);
    const missing = await f.owner.call(`${vaultBase(f.target)}/devices/${first.id}/delivery`);

    expect(missing.status).toBe(404);
    const revoke = { deviceId: randomUUID() };
    const notFound = await f.owner.call(`${vaultBase(f.target)}/devices/revoke`, 'POST', {
      ...revoke,
      authorization: authorize(first, proof.key, 1, 'revoke', revoke),
    });

    expect(notFound.status).toBe(404);

    await resource.db
      .update(vaultSchema.keyScopes)
      .set({ phase: 'rotating' })
      .where(eq(vaultSchema.keyScopes.tenantId, f.target.tenantId));

    const blocked = await f.owner.call(`${vaultBase(f.target)}/devices/request`, 'POST', {
      deviceId: first.id,
      keys: first.keys,
    });

    expect(blocked.status).toBe(409);
  });

  it('checks the roster quota and stops approval after a concurrent rotation starts', async () => {
    const f = await fixture();
    const first = identity();
    const key = await boot(f, first);
    const next = identity();
    const proof = await request(f.owner, f.target, next);
    const body = { proof, delivery: deliver(proof) };
    const [device] = await resource.db
      .select()
      .from(vaultSchema.keyDevices)
      .where(eq(vaultSchema.keyDevices.id, first.id));

    await resource.db
      .insert(vaultSchema.keyDevices)
      .values(Array.from({ length: 63 }, () => ({ ...device, id: randomUUID() })));

    const quota = await f.owner.call(`${vaultBase(f.target)}/devices/approve`, 'POST', {
      ...body,
      authorization: authorize(first, key.key, 1, 'approve', body),
    });

    expect(quota.status).toBe(413);
    const fresh = await request(f.owner, f.target, next);
    const pending = { proof: fresh, delivery: deliver(fresh) };

    await resource.db
      .update(vaultSchema.keyScopes)
      .set({ phase: 'rotating' })
      .where(eq(vaultSchema.keyScopes.tenantId, f.target.tenantId));

    const blocked = await f.owner.call(`${vaultBase(f.target)}/devices/approve`, 'POST', {
      ...pending,
      authorization: authorize(first, key.key, 1, 'approve', pending),
    });

    expect(blocked.status).toBe(409);
  });

  it('rejects duplicate rotation recipients, exhausted generations and stale restored deliveries', async () => {
    const f = await fixture();
    const first = identity();
    const key = await boot(f, first);
    const extra = identity();
    const proof = await request(f.owner, f.target, extra);
    const approval = { proof, delivery: deliver(proof) };
    const added = await f.owner.call(`${vaultBase(f.target)}/devices/approve`, 'POST', {
      ...approval,
      authorization: authorize(first, key.key, 1, 'approve', approval),
    });

    expect(added.status).toBe(200);
    const duplicate = { deliveries: [deliver(key, 2), deliver(key, 2)] };
    const rejected = await f.owner.call(`${vaultBase(f.target)}/devices/rotate`, 'POST', {
      ...duplicate,
      authorization: authorize(first, key.key, 2, 'rotate', duplicate),
    });

    expect(rejected.status).toBe(409);
    const incomplete = { deliveries: [deliver(key, 2)] };
    const missing = await f.owner.call(`${vaultBase(f.target)}/devices/rotate`, 'POST', {
      ...incomplete,
      authorization: authorize(first, key.key, 2, 'rotate', incomplete),
    });

    expect(missing.status).toBe(409);

    await resource.db
      .update(vaultSchema.keyScopes)
      .set({ generation: 2_147_483_647 })
      .where(eq(vaultSchema.keyScopes.tenantId, f.target.tenantId));

    const exhausted = await f.owner.call(`${vaultBase(f.target)}/devices/rotate`, 'POST', {
      ...incomplete,
      authorization: authorize(first, { ...key.key, generation: 2_147_483_647 }, 2, 'rotate', incomplete),
    });

    expect(exhausted.status).toBe(409);
    const stale = await f.owner.call(`${vaultBase(f.target)}/devices/${extra.id}/delivery`);

    expect(stale.status).toBe(409);
  });

  it('rejects unapproved devices, changed idempotency payloads, bad revisions and wrong signed context', async () => {
    const f = await fixture();
    const first = identity();
    const key = await boot(f, first);
    const path = `${vaultBase(f.target)}/sync/push`;
    const unknown = await f.owner.call(path, 'POST', push(identity(), key));

    expect(unknown.status).toBe(403);
    const value = push(first, key);
    const badAction = await f.owner.call(path, 'POST', {
      ...value,
      authorization: { ...value.authorization, epoch: 2 },
    });

    expect(badAction.status).toBe(409);
    const badRevision = structuredClone(value);

    badRevision.envelope.context.revision = 2;
    const revision = await f.owner.call(path, 'POST', resign(first, badRevision));

    expect(revision.status).toBe(409);
    const written = await f.owner.call(path, 'POST', value);

    expect(written.status).toBe(200);
    const changed = { ...value, expectedRevision: 1 };
    const duplicate = await f.owner.call(path, 'POST', resign(first, changed));

    expect(duplicate.status).toBe(409);
    const head = syncHeadSchema.parse(written.body);
    const overwrite = push(first, key, head, 1, 1, value.envelope.context.objectId);
    const conflict = await f.owner.call(path, 'POST', overwrite);

    expect(conflict.status).toBe(409);
    const wrongScope = await f.owner.call(`${base(f.tenant)}/domains/${domain}/sync/pull`, 'POST', {
      protocol: 1,
      head: { cursor: 0, checkpoint: null },
    });

    expect(wrongScope.status).toBe(403);
    const ownContext = push(first, key, head);

    ownContext.envelope.context.target = {
      kind: 'resource',
      tenantId: f.target.tenantId,
      groupId: null,
      resourceId: randomUUID(),
    };
    ownContext.envelope.context.key.scope = ownContext.envelope.context.target;
    const context = await f.owner.call(path, 'POST', ownContext);

    expect(context.status).toBe(409);

    await resource.db
      .update(vaultSchema.opaqueStreams)
      .set({ cursor: 2_147_483_647 })
      .where(eq(vaultSchema.opaqueStreams.tenantId, f.target.tenantId));

    const exhausted = await f.owner.call(path, 'POST', push(first, key, { ...head, cursor: 2_147_483_647 }));

    expect(exhausted.status).toBe(409);
  });

  it('bounds large event pages by bytes and preserves independent scope access', async () => {
    const f = await fixture();
    const first = identity();
    const key = await boot(f, first);
    const firstValue = push(first, key, undefined, 1, 1, randomUUID(), 'record', 1, Buffer.alloc(1_048_576, 1));
    const initial = await f.owner.call(`${vaultBase(f.target)}/sync/push`, 'POST', firstValue);

    expect(initial.status).toBe(200);
    const head = syncHeadSchema.parse(initial.body);
    const next = await f.owner.call(
      `${vaultBase(f.target)}/sync/push`,
      'POST',
      push(first, key, head, 1, 1, randomUUID(), 'snapshot', 1, Buffer.alloc(1_048_576, 2)),
    );

    expect(next.status).toBe(200);
    const page = await f.owner.call(`${vaultBase(f.target)}/sync/pull`, 'POST', {
      protocol: 1,
      head: { cursor: 0, checkpoint: null },
      limit: 100,
    });

    expect(page.body).toMatchObject({ more: true, events: [{ cursor: 1 }] });
  });

  it('enforces configured unit/count/byte quotas before accepting encrypted content', async () => {
    const f = await fixture();
    const policy: ProductPolicy = structuredClone(syntheticHybridPolicy);

    policy.domains[1].quotas = { maxUnitBytes: 128, maxUnits: 1, maxScopeBytes: 4096 };
    const access = new Access(resource.db, policy);
    const tenant = await access.createTenant(f.owner.actor);
    const target = await access.createScope(f.owner.actor, tenant, { kind: 'resource' });
    const devices = new KeyDevices(access);
    const sync = new OpaqueSync(access);
    const first = identity();
    const challenge = await devices.request(f.owner.actor, target, domain, { deviceId: first.id, keys: first.keys });
    const key = prove(first, challenge);

    await devices.bootstrap(f.owner.actor, target, domain, key);

    const oversized = push(first, key, undefined, 1, 1, randomUUID(), 'record', 1, Buffer.alloc(129));

    await expect(sync.write(f.owner.actor, target, domain, oversized)).rejects.toMatchObject({
      code: 'quota_exceeded',
    });

    const value = push(first, key);
    const head = await sync.write(f.owner.actor, target, domain, value);

    await expect(sync.write(f.owner.actor, target, domain, push(first, key, head))).rejects.toMatchObject({
      code: 'quota_exceeded',
    });

    await resource.db
      .update(vaultSchema.opaqueEvents)
      .set({ bytes: 4096 })
      .where(
        and(
          eq(vaultSchema.opaqueEvents.tenantId, target.tenantId),
          eq(vaultSchema.opaqueEvents.scopeId, target.scopeId),
        ),
      );

    await expect(
      sync.write(f.owner.actor, target, domain, push(first, key, head, 1, 2, value.envelope.context.objectId)),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
  });
});
