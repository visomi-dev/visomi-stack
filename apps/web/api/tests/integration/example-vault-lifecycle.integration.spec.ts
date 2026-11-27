import { vaultSchema } from '@visomi-stack/backend-db';
import { exampleWorkspaceTargetSchema, syncHeadSchema } from '@visomi-stack/shared-db';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { base, fixture, grant, resource, enableBackupObjects } from './support/persistence';
import { authorize, boot, deliver, identity, request, push, vaultBase } from './support/vault';

let fault: 'readback' | 'delete' | undefined;

enableBackupObjects((objects) => ({
  ...objects,
  async get(key, bytes) {
    const body = await objects.get(key, bytes);

    return fault === 'readback' ? body.slice(1) : body;
  },
  async delete(key) {
    if (fault === 'delete') {
      throw new Error();
    }

    await objects.delete(key);
  },
}));
it('commits both enrolled identities together and rejects mismatched recovery approval', async () => {
  const f = await fixture();
  const created = await f.owner.call('/example/vault/workspaces/setup', 'POST', {});
  const target = exampleWorkspaceTargetSchema.parse(created.body);
  const primaryDevice = identity();
  const recoveryDevice = identity();
  const make = async (scope: typeof target) => {
    const primary = await request(f.owner, scope, primaryDevice);
    const proof = await request(f.owner, scope, recoveryDevice);
    const body = { proof, delivery: deliver(proof) };

    return { primary, recovery: { ...body, authorization: authorize(primaryDevice, primary.key, 1, 'approve', body) } };
  };
  const submit = (scope: typeof target, body: unknown) =>
    f.owner.call(vaultBase(scope) + '/devices/bootstrap', 'POST', body);
  const input = await make(target);

  for (const invalid of [
    { ...input.recovery, proof: { ...input.recovery.proof, ownerId: f.outsider.actor.principal.id } },
    { ...input.recovery, authorization: { ...input.recovery.authorization, deviceId: recoveryDevice.id } },
    { ...input.recovery, proof: input.primary },
  ]) {
    await expect(submit(target, { primary: input.primary, recovery: invalid })).resolves.toMatchObject({ status: 403 });
  }
  const invalid = { ...input.recovery, authorization: { ...input.recovery.authorization, epoch: 2 } };

  await expect(submit(target, { primary: input.primary, recovery: invalid })).resolves.toMatchObject({ status: 409 });

  await expect(f.owner.call(vaultBase(target) + '/devices')).resolves.toMatchObject({
    status: 409,
    body: { error: 'key_scope_uninitialized' },
  });

  const inline = await make(f.target);

  await expect(submit(f.target, inline)).resolves.toMatchObject({ status: 403 });

  const valid = await make(target);

  await expect(submit(target, valid)).resolves.toMatchObject({ status: 200, body: { epoch: 2 } });

  await expect(f.owner.call(vaultBase(target) + '/devices/' + recoveryDevice.id + '/delivery')).resolves.toMatchObject({
    status: 200,
    body: { authorization: valid.recovery.authorization },
  });
});

it('requires owner confirmation and resumes deletion after a staged object or interrupted storage cleanup', async () => {
  const f = await fixture();
  const create = async () => {
    const response = await f.owner.call('/example/vault/workspaces/setup', 'POST', { additional: true });

    return exampleWorkspaceTargetSchema.parse(response.body);
  };
  const target = await create();
  const device = identity();
  const primary = await boot({ ...f, target }, device);
  const other = await create();

  await boot({ ...f, target: other }, identity());

  const endpoint = '/example/vault/workspaces/' + target.tenantId + '/' + target.scopeId;
  const removal = (scopeId = target.scopeId) => f.owner.call(endpoint, 'DELETE', { confirmScopeId: scopeId });

  await expect(removal(other.scopeId)).resolves.toMatchObject({ status: 403 });

  await expect(f.outsider.call(endpoint, 'DELETE', { confirmScopeId: target.scopeId })).resolves.toMatchObject({
    status: 403,
  });

  await expect(
    f.owner.call(base({ tenantId: target.tenantId, scopeId: target.tenantId }) + '/members', 'PUT', {
      userId: f.member.actor.principal.id,
      active: true,
    }),
  ).resolves.toMatchObject({ status: 200 });

  await grant(f, 'manager', target);

  await expect(f.member.call(endpoint, 'DELETE', { confirmScopeId: target.scopeId })).resolves.toMatchObject({
    status: 403,
  });

  await expect(
    f.owner.call('/example/vault/workspaces/' + f.tenant.tenantId + '/' + f.tenant.scopeId, 'DELETE', {
      confirmScopeId: f.tenant.scopeId,
    }),
  ).resolves.toMatchObject({ status: 403 });

  await expect(
    f.owner.call('/example/vault/workspaces/' + f.target.tenantId + '/' + f.target.scopeId, 'DELETE', {
      confirmScopeId: f.target.scopeId,
    }),
  ).resolves.toMatchObject({ status: 403 });

  const write = push(device, primary);
  const stored = await f.owner.call(vaultBase(target) + '/sync/push', 'POST', write);

  expect(stored.status).toBe(200);

  try {
    fault = 'readback';

    await expect(
      f.owner.call(
        vaultBase(target) + '/sync/push',
        'POST',
        push(device, primary, syncHeadSchema.parse(stored.body), 1, 2, write.envelope.context.objectId),
      ),
    ).resolves.toMatchObject({ status: 503 });

    await expect(removal()).resolves.toMatchObject({ status: 409 });

    await resource.db
      .update(vaultSchema.backupStaging)
      .set({ expiresAt: new Date(0) })
      .where(eq(vaultSchema.backupStaging.scopeId, target.scopeId));

    fault = 'delete';

    await expect(removal()).resolves.toMatchObject({ status: 503 });

    await expect(f.owner.call(vaultBase(target) + '/devices')).resolves.toMatchObject({ status: 409 });
  } finally {
    fault = undefined;
  }

  await expect(removal()).resolves.toMatchObject({ status: 200 });

  await expect(f.owner.call(vaultBase(target) + '/devices')).resolves.toMatchObject({ status: 403 });

  await expect(f.owner.call(vaultBase(other) + '/devices')).resolves.toMatchObject({ status: 200 });

  await expect(
    f.owner.call('/example/vault/workspaces/' + other.tenantId + '/' + other.scopeId, 'DELETE', {
      confirmScopeId: other.scopeId,
    }),
  ).resolves.toMatchObject({ status: 200 });
});
