import { vaultSchema } from '@visomi-stack/backend-db';
import { backupBucket, backupS3Client } from '@visomi-stack/dev-testing/s3';
import {
  createOperationId,
  serializeDataEnvelope,
  syncHeadSchema,
  syncReadBody,
  syncPageSchema,
} from '@visomi-stack/shared-db';
import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';

import { Access } from '../../src/access/service';
import { OpaqueSync } from '../../src/db/opaque';

import {
  base,
  backupObjects,
  browserSession,
  enableBackupObjects,
  fixture,
  policy,
  resource,
  s3Endpoint,
} from './support/persistence';
import { authorize, boot, digest, identity, push, vaultBase } from './support/vault';

let fault: 'put' | 'readback' | undefined;

enableBackupObjects((objects) => ({
  ...objects,
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

    for (const failure of ['put', 'readback'] as const) {
      fault = failure;

      await expect(f.owner.call(`${path}/push`, 'POST', next)).resolves.toMatchObject({
        status: 503,
        body: { error: 'vault_backup_unavailable' },
      });

      await expect(stored()).resolves.toEqual([unit]);

      await expect(history()).resolves.toEqual([event]);
    }

    fault = undefined;
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

    await expect(f.owner.call(`${path}/push`, 'POST', next)).resolves.toMatchObject({ status: 200 });
  } finally {
    fault = undefined;
  }
}, 30_000);
