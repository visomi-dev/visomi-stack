import { vaultSchema } from '@visomi-stack/backend-db';
import { backupBucket, backupS3Client } from '@visomi-stack/dev-testing/s3';
import {
  createOperationId,
  exampleWorkspaceTargetSchema,
  serializeDataEnvelope,
  syncHeadSchema,
  syncReadBody,
  syncPageSchema,
  syncWatchBody,
} from '@visomi-stack/shared-db';
import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';

import { Access } from '../../src/access/service';
import { BackupPayloads } from '../../src/db/backup-payload';
import { PersistenceMaintenance } from '../../src/db/maintenance';
import { OpaqueSync } from '../../src/db/opaque';
import { createVaultWatch } from '../../src/db/vault-watch';

import {
  base,
  backupObjects,
  browserSession,
  enableBackupObjects,
  fixture,
  policy,
  resource,
  s3Endpoint,
  vaultNotice,
} from './support/persistence';
import { authorize, boot, digest, identity, push, request, vaultBase } from './support/vault';

let fault: 'put' | 'readback' | 'delete' | undefined;

enableBackupObjects((objects) => ({
  ...objects,
  async delete(key) {
    if (fault === 'delete') {
      throw new Error();
    }

    await objects.delete(key);
  },
  async put(key, body) {
    if (fault === 'put') {
      throw new Error();
    }

    await objects.put(key, body);
  },
  async get(key, bytes) {
    const body = await objects.get(key, bytes);

    return fault === 'readback' ? body.slice(1) : body;
  },
}));

it.each(['new', 'legacy'] as const)('lists only committed vaults and resumes %s setup', async (mode) => {
  const f = await fixture();
  const directory = '/example/vault/workspaces';
  const setup = `${directory}/setup`;
  let legacy: ReturnType<typeof exampleWorkspaceTargetSchema.parse> | undefined;

  if (mode === 'legacy') {
    const created = await f.owner.call(`${base(f.tenant)}/children`, 'POST', { kind: 'resource', objectBackup: true });

    expect(created.status).toBe(200);
    legacy = exampleWorkspaceTargetSchema.parse(created.body);
  }

  await expect(f.owner.call(directory)).resolves.toMatchObject({
    status: 200,
    body: { items: [], pendingSetup: mode === 'legacy' },
  });

  await expect(f.outsider.call(directory)).resolves.toMatchObject({
    status: 200,
    body: { items: [], pendingSetup: false },
  });

  const session = await browserSession(f.owner.actor.principal);
  const [first, retry] = await Promise.all([
    f.owner.call(setup, 'POST', {}),
    f.owner.call(setup, 'POST', {}, { cookie: `visomi.sid=${session.cookie}`, 'x-csrf-token': session.csrf }),
  ]);

  expect(first.status).toBe(200);
  expect(retry).toMatchObject({ status: 200, body: first.body });
  const target = exampleWorkspaceTargetSchema.parse(first.body);

  if (legacy) {
    expect(target).toEqual(legacy);
  }

  await expect(f.owner.call(directory)).resolves.toMatchObject({
    status: 200,
    body: { items: [], next: null, pendingSetup: true },
  });

  await expect(f.owner.call(`${vaultBase(target)}/devices`)).resolves.toMatchObject({
    status: 409,
    body: { error: 'key_scope_uninitialized' },
  });

  const proofs = await Promise.all([request(f.owner, target, identity()), request(f.owner, target, identity())]);
  const bootstraps = await Promise.all(
    proofs.map((proof) => f.owner.call(`${vaultBase(target)}/devices/bootstrap`, 'POST', proof)),
  );

  expect(bootstraps.map(({ status }) => status).sort()).toEqual([200, 409]);

  await expect(f.owner.call(directory)).resolves.toMatchObject({
    status: 200,
    body: { items: [{ ...target, objectId: null }], next: null, pendingSetup: false },
  });

  await expect(f.owner.call(setup, 'POST', {})).resolves.toMatchObject({ status: 200, body: null });
});

it('stores ciphertext privately and publishes only verified references for the current device and scope', async () => {
  const f = await fixture();
  const childPath = `${base(f.tenant)}/children`;

  await expect(f.owner.call('/example/vault/policy')).resolves.toMatchObject({
    status: 200,
    body: { objectBackups: true },
  });

  await expect(f.owner.call(childPath, 'POST', { kind: 'group', objectBackup: true })).resolves.toMatchObject({
    status: 403,
  });

  await expect(
    f.owner.call(`${base(f.group)}/children`, 'POST', { kind: 'resource', objectBackup: true }),
  ).resolves.toMatchObject({ status: 403 });

  await expect(
    f.owner.call(childPath, 'POST', { kind: 'resource', objectBackup: true, objectPath: 'other-resource' }),
  ).resolves.toMatchObject({ status: 400 });

  const created = await f.owner.call(childPath, 'POST', { kind: 'resource', objectBackup: true });

  expect(created.status).toBe(200);
  const scoped = { ...f, target: { tenantId: created.body.tenantId, scopeId: created.body.scopeId } };
  const device = identity();
  const proof = await boot(scoped, device);

  await expect(f.owner.call(`${vaultBase(scoped.target)}/devices`)).resolves.toMatchObject({
    status: 200,
    body: { objectBackup: true },
  });

  const path = `${vaultBase(scoped.target)}/sync`;
  const read = { protocol: 1 as const, head: { cursor: 0, checkpoint: null }, limit: 25 };
  const signRead = (signer = device, op = createOperationId(globalThis.crypto)) => ({
    ...read,
    authorization: authorize(signer, proof.key, 1, 'sync', syncReadBody(read, f.owner.browserAuth.csrf), op),
  });
  const good = signRead();

  const watch = createVaultWatch(resource.db);
  const session = { id: f.owner.actor.sessionId, user: f.owner.actor.principal, csrf: f.owner.browserAuth.csrf };
  const signWatch = (key = proof.key, op = createOperationId(globalThis.crypto)) =>
    authorize(device, key, 1, 'sync', syncWatchBody(session.csrf), op);

  await expect(watch(session, signWatch())).resolves.toBe(scoped.target.scopeId);

  await expect(watch(session, undefined)).rejects.toMatchObject({ status: 400 });

  await expect(watch({ ...session, csrf: undefined }, signWatch())).rejects.toMatchObject({ status: 403 });

  await expect(watch({ ...session, csrf: 'different-session-token' }, signWatch())).rejects.toMatchObject({
    status: 400,
  });

  await expect(watch({ ...session, user: undefined }, signWatch())).rejects.toMatchObject({ status: 401 });

  const illegalScope = { kind: 'tenant' as const, tenantId: scoped.target.tenantId };

  await expect(watch(session, signWatch({ ...proof.key, scope: illegalScope }))).rejects.toMatchObject({ status: 403 });

  const inlineScope = { ...proof.key.scope, resourceId: f.target.scopeId };

  await expect(watch(session, signWatch({ ...proof.key, scope: inlineScope }))).rejects.toMatchObject({ status: 403 });

  const { keyDevices, keyScopes } = vaultSchema;
  const scopeRegistry = eq(keyScopes.scopeId, scoped.target.scopeId);

  await resource.db.update(keyScopes).set({ phase: 'rotating' }).where(scopeRegistry);

  await expect(watch(session, signWatch())).rejects.toMatchObject({ status: 409, code: 'rotation_required' });

  await resource.db.update(keyScopes).set({ phase: 'ready' }).where(scopeRegistry);

  const enrolled = eq(keyDevices.scopeId, scoped.target.scopeId);

  await resource.db.update(keyDevices).set({ revokedAt: new Date() }).where(enrolled);

  await expect(watch(session, signWatch())).rejects.toMatchObject({ status: 403, code: 'device_approval_required' });

  await resource.db.update(keyDevices).set({ revokedAt: null }).where(enrolled);

  vaultNotice.mockResolvedValue(undefined);

  const s3 = backupS3Client(s3Endpoint);

  try {
    const unconfigured = new OpaqueSync(new Access(resource.db, policy));

    await expect(unconfigured.read(f.owner.actor, scoped.target, 'private-resources', good)).rejects.toMatchObject({
      status: 403,
    });

    await expect(
      unconfigured.read(f.owner.actor, scoped.target, 'private-resources', good, f.owner.browserAuth.csrf),
    ).rejects.toMatchObject({ status: 503 });

    await expect(f.owner.call(`${path}/pull`, 'POST', read)).resolves.toMatchObject({ status: 403 });

    await expect(f.outsider.call(`${path}/pull`, 'POST', good)).resolves.toMatchObject({ status: 403 });

    await expect(f.owner.call(`${path}/pull`, 'POST', signRead(identity()))).resolves.toMatchObject({ status: 403 });

    await expect(f.owner.call(`${path}/pull`, 'POST', { ...good, limit: 24 })).resolves.toMatchObject({ status: 400 });

    const otherSession = await browserSession(f.owner.actor.principal);

    await expect(
      f.owner.call(`${path}/pull`, 'POST', good, {
        cookie: `visomi.sid=${otherSession.cookie}`,
        'x-csrf-token': otherSession.csrf,
      }),
    ).resolves.toMatchObject({ status: 400 });

    const stale = createOperationId(globalThis.crypto, Date.now() - 40 * 86_400_000);

    await expect(f.owner.call(`${path}/pull`, 'POST', signRead(device, stale))).resolves.toMatchObject({ status: 409 });

    await expect(f.owner.call(`${path}/pull`, 'POST', good)).resolves.toMatchObject({
      status: 200,
      body: { events: [] },
    });

    const value = push(device, proof);
    const published = await f.owner.call(`${path}/push`, 'POST', value);

    expect(published.status).toBe(200);

    await expect(f.owner.call('/example/vault/workspaces')).resolves.toMatchObject({
      status: 200,
      body: {
        items: [{ ...scoped.target, objectId: value.envelope.context.objectId, owner: true }],
        next: null,
      },
    });

    await expect(f.outsider.call('/example/vault/workspaces')).resolves.toMatchObject({
      status: 200,
      body: { items: [], next: null },
    });

    const head = syncHeadSchema.parse(published.body);
    const wire = serializeDataEnvelope(value.envelope);
    const { opaqueEvents, opaqueUnits } = vaultSchema;
    const stored = () => resource.db.select().from(opaqueUnits).where(eq(opaqueUnits.scopeId, scoped.target.scopeId));
    const history = () =>
      resource.db.select().from(opaqueEvents).where(eq(opaqueEvents.scopeId, scoped.target.scopeId));
    const [unit] = await stored();
    const [event] = await history();

    expect(unit.envelope).toEqual({
      format: 'vault-object',
      version: 1,
      generation: 1,
      id: expect.any(String),
      digest: digest(wire),
    });
    expect(event.envelope).toEqual(unit.envelope);
    expect(event.bytes).toBe(Buffer.byteLength(wire));
    expect(JSON.stringify([unit, event])).not.toContain(value.envelope.ciphertext);
    const key = `vault-backups/${scoped.target.scopeId}/${(unit.envelope as { id: string }).id}`;
    const get = await s3('GET', key);
    const bytes = await get.text();

    expect(bytes).toBe(wire);

    const network = vi.spyOn(globalThis, 'fetch');

    try {
      await expect(backupObjects!.put(key, 'synthetic replacement ciphertext')).rejects.toMatchObject({ status: 503 });

      expect(network).toHaveBeenCalledOnce();
      expect(network.mock.calls[0][1]?.headers).toMatchObject({ 'if-none-match': '*' });
      const duplicate = await network.mock.results[0].value;

      expect(duplicate.status).toBe(412);
    } finally {
      network.mockRestore();
    }

    await expect(backupObjects!.get(key, Buffer.byteLength(wire))).resolves.toBe(wire);

    const publicObject = await fetch(`${s3Endpoint}/${backupBucket}/${key}`);

    expect(publicObject.status).toBe(403);
    const pulled = await f.owner.call(`${path}/pull`, 'POST', good);

    expect(syncPageSchema.parse(pulled.body).events[0].envelope).toEqual(value.envelope);

    const next = push(device, proof, head, 1, 2, unit.id);
    const { backupStaging } = vaultSchema;
    const stageScope = eq(backupStaging.scopeId, scoped.target.scopeId);
    const stages = () => resource.db.select().from(backupStaging).where(stageScope);
    const maintenance = `${vaultBase(scoped.target)}/maintenance`;
    let reservedId: string | undefined;

    for (const failure of ['put', 'readback'] as const) {
      fault = failure;

      await expect(f.owner.call(`${path}/push`, 'POST', next)).resolves.toMatchObject({
        status: 503,
        body: { error: 'vault_backup_unavailable' },
      });

      await expect(stored()).resolves.toEqual([unit]);

      await expect(history()).resolves.toEqual([event]);

      const [stage] = await stages();

      expect(stage).toMatchObject({
        operationId: next.operationId,
        bytes: Buffer.byteLength(serializeDataEnvelope(next.envelope)),
      });
      reservedId ??= stage.id;
      expect(stage.id).toBe(reservedId);
    }

    fault = undefined;
    const competitor = push(device, proof, head, 1, 2, unit.id);
    const { authorization: _authorization, ...changed } = { ...competitor, operationId: next.operationId };

    await expect(f.owner.call(`${path}/push`, 'POST', competitor)).resolves.toMatchObject({ status: 503 });

    await expect(
      f.owner.call(`${path}/push`, 'POST', {
        ...changed,
        authorization: authorize(device, proof.key, 1, 'sync', changed, next.operationId),
      }),
    ).resolves.toMatchObject({ status: 409, body: { error: 'idempotency_conflict' } });

    await expect(f.owner.call(maintenance, 'POST', { limit: 1 })).resolves.toMatchObject({
      body: { abandonedObjects: 0 },
    });

    const replaceBytes = async (body: string) => {
      const result = await s3('PUT', key, body);

      await result.body?.cancel();
    };

    await replaceBytes(wire.slice(1));

    await expect(f.owner.call(`${path}/pull`, 'POST', good)).resolves.toMatchObject({ status: 503 });

    await replaceBytes(`!${wire.slice(1)}`);

    await expect(f.owner.call(`${path}/pull`, 'POST', good)).resolves.toMatchObject({ status: 503 });

    await expect(stored()).resolves.toEqual([unit]);

    await replaceBytes(wire);

    fault = 'readback';

    await expect(f.owner.call(`${path}/pull`, 'POST', good)).resolves.toMatchObject({ status: 503 });

    fault = undefined;

    const eventScope = eq(opaqueEvents.scopeId, scoped.target.scopeId);

    if (event.envelope.format !== 'vault-object') {
      throw new Error('Expected an object reference');
    }

    for (const size of [0, 1_500_000]) {
      await resource.db.update(opaqueEvents).set({ bytes: size }).where(eventScope);

      await expect(f.owner.call(`${path}/pull`, 'POST', good)).resolves.toMatchObject({ status: 503 });
    }

    await resource.db
      .update(opaqueEvents)
      .set({ bytes: event.bytes, envelope: { ...event.envelope, generation: 99 } })
      .where(eventScope);

    await expect(f.owner.call(`${path}/pull`, 'POST', good)).resolves.toMatchObject({ status: 503 });

    await resource.db.update(opaqueEvents).set({ envelope: event.envelope }).where(eventScope);

    await expect(f.owner.call(`${path}/pull`, 'POST', good)).resolves.toMatchObject({ status: 200 });

    const access = new Access(resource.db, policy);
    const withScope = access.withScope.bind(access);
    let staged!: () => void;
    let resume!: () => void;
    const stagedWrite = new Promise<void>((resolve) => {
      staged = resolve;
    });
    const resumeWrite = new Promise<void>((resolve) => {
      resume = resolve;
    });

    // Pause after the first transaction commits, leaving the original retry's publication pending.
    vi.spyOn(access, 'withScope').mockImplementationOnce(async (actor, target, action, work) => {
      const result = await withScope(actor, target, action, work);

      staged();

      await resumeWrite;

      return result;
    });
    vaultNotice.mockRejectedValueOnce(new Error('synthetic pubsub outage'));
    const retrying = new OpaqueSync(access, backupObjects, vaultNotice);
    const repeated = retrying.write(f.owner.actor, scoped.target, 'private-resources', next);

    await Promise.race([
      stagedWrite,
      repeated.then(() => {
        throw new Error('retry_did_not_stage');
      }),
    ]);

    const completed = await f.owner.call(`${path}/push`, 'POST', next).finally(resume);

    expect(completed.status).toBe(200);

    await expect(repeated).resolves.toEqual(completed.body);

    expect(vaultNotice.mock.calls).toEqual([
      [scoped.target.scopeId, 1],
      [scoped.target.scopeId, 2],
    ]);

    await expect(stages()).resolves.toEqual([]);

    const [second] = await stored();

    expect(second.envelope).toMatchObject({ id: reservedId });

    const secondHead = syncHeadSchema.parse(completed.body);
    const interrupted = push(device, proof, secondHead, 1, 3, unit.id);

    const rollback = vi.spyOn(BackupPayloads.prototype, 'clear').mockRejectedValueOnce(new Error('synthetic rollback'));

    try {
      await expect(f.owner.call(`${path}/push`, 'POST', interrupted)).resolves.toMatchObject({
        status: 503,
        body: { error: 'persistence_unavailable' },
      });
    } finally {
      rollback.mockRestore();
    }

    const [abandoned] = await stages();

    expect(vaultNotice).toHaveBeenCalledTimes(2);
    const abandonedKey = `vault-backups/${scoped.target.scopeId}/${abandoned.id}`;
    const orphan = await s3('GET', abandonedKey);

    expect(orphan.ok).toBe(true);

    await orphan.body?.cancel();

    await resource.db
      .update(backupStaging)
      .set({ expiresAt: new Date(0) })
      .where(stageScope);

    const payloads = new BackupPayloads(backupObjects);

    await expect(
      access.withScope(f.owner.actor, scoped.target, 'write', (context) =>
        payloads.publish(context, { id: abandoned.id, retry: true }, interrupted.envelope, '', 1),
      ),
    ).rejects.toMatchObject({ status: 503 });

    await expect(f.outsider.call(maintenance, 'POST', { limit: 1 })).resolves.toMatchObject({ status: 403 });

    await expect(
      f.owner.call(maintenance.replace('/private-resources/', '/operations/'), 'POST', { limit: 1 }),
    ).resolves.toMatchObject({ status: 409, body: { error: 'domain_adapter_incompatible' } });

    fault = 'delete';

    await expect(f.owner.call(`${path}/push`, 'POST', interrupted)).resolves.toMatchObject({
      status: 503,
      body: { error: 'vault_backup_unavailable' },
    });

    await expect(f.owner.call(maintenance, 'POST', { limit: 1 })).resolves.toMatchObject({ status: 503 });

    await expect(stages()).resolves.toMatchObject([{ id: abandoned.id }]);

    fault = undefined;

    await expect(f.owner.call(maintenance, 'POST', { limit: 1 })).resolves.toMatchObject({
      body: { abandonedObjects: 1 },
    });

    await expect(s3('GET', abandonedKey)).rejects.toThrow('isolated_s3_request_failed');

    await expect(stages()).resolves.toEqual([]);

    await expect(stored()).resolves.toEqual([second]);

    await expect(backupObjects!.get(key, Buffer.byteLength(wire))).resolves.toBe(wire);

    await expect(
      new PersistenceMaintenance(access).run(f.owner.actor, f.target, 'private-resources', { limit: 1 }, true),
    ).rejects.toMatchObject({ status: 409, code: 'capability_unavailable' });

    await expect(
      new OpaqueSync(access, backupObjects).write(f.owner.actor, scoped.target, 'private-resources', interrupted),
    ).resolves.toMatchObject({ cursor: 3 });

    expect(vaultNotice).toHaveBeenCalledTimes(2);
  } finally {
    fault = undefined;
  }
}, 30_000);
