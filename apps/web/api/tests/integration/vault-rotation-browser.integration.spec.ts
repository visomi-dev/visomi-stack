import { randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';
import { syncHeadSchema, type ApprovedDelivery, type KeyDomain } from '@visomi-stack/shared-db';

import { fixture } from './support/persistence';
import { browserServer, type FixtureHost } from './support/browser-server';
import { authorize, boot, deliver, identity, push, vaultBase } from './support/vault';

it('replays pre-rotation history on a newly approved device without resetting its checkpoint', async () => {
  const f = await fixture();
  const signer = identity();
  const first = await boot(f, signer);
  const objectId = randomUUID();
  const created = await f.owner.call(
    `${vaultBase(f.target)}/sync/push`,
    'POST',
    push(signer, first, undefined, 1, 1, objectId),
  );

  expect(created.status).toBe(200);
  const firstHead = syncHeadSchema.parse(created.body);
  const deletedId = randomUUID();
  const obsolete = await f.owner.call(
    `${vaultBase(f.target)}/sync/push`,
    'POST',
    push(signer, first, firstHead, 1, 1, deletedId),
  );

  expect(obsolete.status).toBe(200);
  const tombstone = await f.owner.call(
    `${vaultBase(f.target)}/sync/push`,
    'POST',
    push(signer, first, syncHeadSchema.parse(obsolete.body), 1, 2, deletedId, 'tombstone'),
  );

  expect(tombstone.status).toBe(200);
  const rotation = { deliveries: [deliver(first, 2, Buffer.alloc(32, 23))] };
  const rotated = await f.owner.call(`${vaultBase(f.target)}/devices/rotate`, 'POST', {
    ...rotation,
    authorization: authorize(signer, first.key, 1, 'rotate', rotation),
  });

  expect(rotated.status).toBe(200);
  const key: KeyDomain = { ...first.key, generation: 2 };
  const currentId = randomUUID();
  const current = await f.owner.call(
    `${vaultBase(f.target)}/sync/push`,
    'POST',
    push(
      signer,
      first,
      syncHeadSchema.parse(tombstone.body),
      2,
      1,
      currentId,
      'record',
      2,
      Buffer.from('Synthetic current generation'),
      Buffer.alloc(32, 23),
    ),
  );

  expect(current.status).toBe(200);
  const currentHead = syncHeadSchema.parse(current.body);
  const server = await browserServer();

  try {
    const browser = await server.client(f.owner.browserAuth.cookie);
    let proof = await browser.page.evaluate(
      async ({ key, csrf, path, ownerId }) => {
        const host = globalThis as FixtureHost;
        const { api, contracts } = host.modules;
        const environment = {
          origin: location.origin,
          rpId: location.hostname,
          credentials: navigator.credentials,
          crypto,
        };
        const methodId = await api.createPrfCredential(environment, new AbortController().signal);
        const binding = {
          key,
          ownerId,
          deviceId: crypto.randomUUID(),
          method: 'passkey-prf' as const,
          methodId,
          origin: location.origin,
        };
        const vaultStorage = await api.IndexedDbVaultStorage.open(indexedDB, ownerId);
        const vault = new api.BrowserVault(
          ownerId,
          vaultStorage,
          new api.PrfUnlock(environment),
          new api.WebCryptoCipher(crypto),
        );
        const custodyStorage = await api.IndexedDbVaultStorage.open(indexedDB, ownerId);
        const custody = new api.DeviceCustody(custodyStorage, binding, new api.PrfUnlock(environment), crypto);

        await custody.unlock(true);

        const keys = await custody.publicKeys();
        const response = await fetch(`${path}/devices/request`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({ deviceId: binding.deviceId, keys }),
        });
        const raw = await response.json();
        const challenge = await custody.prove(contracts.deviceChallengeSchema.parse(raw));
        const storage = await api.IndexedDbReplicaStorage.open(indexedDB, ownerId);

        host.client = { binding, vault, custody, challenge, storage, csrf, path };

        return challenge;
      },
      { key, csrf: f.owner.browserAuth.csrf, ownerId: f.owner.actor.principal.id, path: `/api${vaultBase(f.target)}` },
    );
    const incomplete = { proof, delivery: deliver(proof, 2, Buffer.alloc(32, 23)) };
    const missing = await f.owner.call(`${vaultBase(f.target)}/devices/approve`, 'POST', {
      ...incomplete,
      authorization: authorize(signer, key, 2, 'approve', incomplete),
    });

    expect(missing.status).toBe(409);
    expect(missing.body).toEqual({ error: 'device_history_required' });

    // Failed attempts consume their challenge. Obtain a fresh proof without replacing the local identity.
    const fresh = await f.owner.call(`${vaultBase(f.target)}/devices/request`, 'POST', {
      deviceId: proof.deviceId,
      keys: proof.keys,
    });

    expect(fresh.status).toBe(200);
    const nextProof = await browser.page.evaluate(async (raw) => {
      const {
        client,
        modules: { contracts },
      } = globalThis as FixtureHost;
      const proof = await client.custody.prove(contracts.deviceChallengeSchema.parse(raw));

      client.challenge = proof;

      return proof;
    }, fresh.body);

    proof = nextProof;
    const body = { proof, delivery: deliver(proof, 2, Buffer.alloc(32, 23)), history: [deliver(proof, 1)] };
    const approved = await f.owner.call(`${vaultBase(f.target)}/devices/approve`, 'POST', {
      ...body,
      authorization: authorize(signer, key, 2, 'approve', body),
    });

    expect(approved.status).toBe(200);
    const result = await browser.page.evaluate(
      async ({ signing, deviceId, objectId, deletedId, currentId }) => {
        const {
          client,
          modules: { api, contracts },
        } = globalThis as FixtureHost;
        const response = await fetch(`${client.path}/devices/${client.binding.deviceId}/delivery`);
        const approved: ApprovedDelivery = await response.json();
        const fingerprint = await new api.WebCryptoDevices(crypto).fingerprint(client.challenge);
        const expected = {
          key: client.binding.key,
          ownerId: client.binding.ownerId,
          deviceId: client.binding.deviceId,
          requestId: client.challenge.requestId,
          challenge: client.challenge.challenge,
          fingerprint,
          encryption: client.challenge.keys.encryption,
        };
        const raw = await client.custody.open(expected, approved, { deviceId, signing });

        try {
          await client.vault.install(client.binding, raw);
        } finally {
          raw.fill(0);
        }

        const id = api.replicaId(client.binding.ownerId, client.binding.key, client.binding.key.scope);
        let rewind: { generation?: number; epoch?: number } = {};
        const replica = new api.SyncReplica(
          id,
          client.binding.key,
          client.binding.key.scope,
          client.storage,
          {
            pull: async (head, signal) => {
              const response = await fetch(`${client.path}/sync/pull`, {
                method: 'POST',
                signal,
                headers: { 'content-type': 'application/json', 'x-csrf-token': client.csrf },
                body: JSON.stringify({ protocol: 1, head }),
              });
              const raw = await response.json();

              if (!response.ok) {
                throw new Error(raw.error);
              }

              return { ...raw, ...rewind };
            },
            push: async (value, signal) => {
              const response = await fetch(`${client.path}/sync/push`, {
                method: 'POST',
                signal,
                headers: { 'content-type': 'application/json', 'x-csrf-token': client.csrf },
                body: JSON.stringify(value),
              });
              const raw = await response.json();

              if (!response.ok) {
                throw new Error(raw.error);
              }

              return raw;
            },
          },
          crypto,
          async (envelope) => {
            const clear = await client.vault.decrypt(envelope.context, envelope);

            clear.fill(0);
          },
          approved.authorization.epoch + 1,
        );

        client.replica = replica;
        const makeWrite = async (
          objectId: string,
          revision: number,
          head: { cursor: number; checkpoint?: string | null },
          text: string,
        ) => {
          const bytes = new TextEncoder().encode(text);
          let envelope;

          try {
            const encrypted = await client.vault.encrypt(
              {
                key: client.binding.key,
                target: client.binding.key.scope,
                objectId,
                revision,
                schemaVersion: 1,
                kind: 'record',
                previousCheckpoint: head.checkpoint ?? null,
              },
              bytes,
            );

            envelope = encrypted;
          } finally {
            bytes.fill(0);
          }

          const operationId = contracts.createOperationId(crypto);
          const body = {
            protocol: 1 as const,
            operationId,
            expectedRevision: revision - 1,
            head: { cursor: head.cursor, checkpoint: head.checkpoint ?? null },
            envelope,
          };
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
          const authorization = await client.custody.sign({
            key: client.binding.key,
            deviceId: client.binding.deviceId,
            operationId,
            epoch: approved.authorization.epoch + 1,
            action: 'sync',
            bodyHash: api.encodeBytes(new Uint8Array(digest)),
          });

          return contracts.syncWriteSchema.parse({ ...body, authorization });
        };
        const pending = await makeWrite(
          crypto.randomUUID(),
          1,
          { cursor: 0, checkpoint: null },
          'Synthetic pending recipient edit',
        );

        await replica.enqueue(pending);

        let missingKey = '';

        try {
          await replica.pull();
        } catch (error) {
          missingKey = (error as { code: string }).code;
        }

        const before = await client.storage.pin(id);

        await client.vault.unlock(client.binding);

        if (approved.witness.kind !== 'enrollment') {
          throw new Error('synthetic_enrollment_required');
        }

        for (const historical of approved.witness.history ?? []) {
          const raw = await client.custody.open(
            expected,
            approved,
            { deviceId, signing },
            historical.binding.key.generation,
          );

          try {
            await client.vault.installHistory(historical.binding.key, raw);
          } finally {
            raw.fill(0);
          }
        }

        const rollback: string[] = [];

        for (const advertised of [{ generation: 1 }, { epoch: approved.authorization.epoch }]) {
          rewind = advertised;

          try {
            await replica.pull();
          } catch (error) {
            rollback.push((error as { code: string }).code);
          }
        }

        const afterRollback = await client.storage.pin(id);

        rewind = {};

        await replica.pull();

        const unit = await client.storage.unit(id, objectId);
        const clear = await client.vault.decrypt(unit!.context, unit!);
        const text = new TextDecoder().decode(clear);

        clear.fill(0);

        const pin = await client.storage.pin(id);
        const deleted = await client.storage.unit(id, deletedId);
        const latest = await client.storage.unit(id, currentId);
        const currentClear = await client.vault.decrypt(latest!.context, latest!);
        const pendingAfter = await client.storage.pending(id);

        currentClear.fill(0);

        // This is an explicit fixture decision, never part of pull/retry or bootstrap.
        await replica.resolve(pending.operationId, null);

        const changed = await makeWrite(objectId, 2, pin, 'Synthetic new recipient write');

        await replica.enqueue(changed);

        await replica.flush();

        const published = await client.storage.pin(id);
        const afterFlush = await client.storage.pending(id);
        const changedUnit = await client.storage.unit(id, objectId);
        const changedClear = await client.vault.decrypt(changedUnit!.context, changedUnit!);

        try {
          return {
            text,
            changedText: new TextDecoder().decode(changedClear),
            pin,
            before,
            missingKey,
            rollback,
            afterRollback,
            deleted: deleted?.context.kind,
            current: latest?.context.key.generation,
            preservedPending: JSON.stringify(pending) === JSON.stringify(pendingAfter),
            published,
            acknowledged: afterFlush === undefined,
          };
        } finally {
          changedClear.fill(0);
        }
      },
      { signing: signer.keys.signing, deviceId: signer.id, objectId, deletedId, currentId },
    );

    expect(result.text).toBe('Synthetic secret payload');
    expect(result.changedText).toBe('Synthetic new recipient write');
    expect(result.missingKey).toBe('recovery-required');
    expect(result.before).toEqual({ cursor: 0, checkpoint: null, generation: 1, epoch: 1 });
    expect(result.rollback).toEqual(['context-mismatch', 'context-mismatch']);
    expect(result.afterRollback).toEqual(result.before);
    expect(result.deleted).toBe('tombstone');
    expect(result.current).toBe(2);
    expect(result.pin).toMatchObject({ ...currentHead, generation: 2, epoch: 3 });
    expect(result.preservedPending).toBe(true);
    expect(result.acknowledged).toBe(true);
    expect(result.published).toMatchObject({ cursor: 5, generation: 2, epoch: 3 });

    const revocation = { deviceId: proof.deviceId };
    const revoked = await f.owner.call(`${vaultBase(f.target)}/devices/revoke`, 'POST', {
      ...revocation,
      authorization: authorize(signer, key, 3, 'revoke', revocation),
    });

    expect(revoked.status).toBe(200);
    const nextRotation = { deliveries: [deliver(first, 3, Buffer.alloc(32, 31))] };
    const next = await f.owner.call(`${vaultBase(f.target)}/devices/rotate`, 'POST', {
      ...nextRotation,
      authorization: authorize(signer, key, 4, 'rotate', nextRotation),
    });

    expect(next.status).toBe(200);
    const future = await f.owner.call(
      `${vaultBase(f.target)}/sync/push`,
      'POST',
      push(
        signer,
        first,
        { cursor: result.published.cursor, checkpoint: result.published.checkpoint },
        5,
        3,
        objectId,
        'record',
        3,
        Buffer.from('Synthetic revoked-device exclusion'),
        Buffer.alloc(32, 31),
      ),
    );

    expect(future.status).toBe(200);
    const denied = await f.owner.call(`${vaultBase(f.target)}/devices/${proof.deviceId}/delivery`);

    expect(denied.status).toBe(404);
    expect(denied.body).toEqual({ error: 'device_delivery_unavailable' });
    const isolated = await browser.page.evaluate(async () => {
      const {
        client,
        modules: { api },
      } = globalThis as FixtureHost;
      const id = api.replicaId(client.binding.ownerId, client.binding.key, client.binding.key.scope);
      let code = '';

      try {
        await client.replica!.pull();
      } catch (error) {
        code = (error as { code: string }).code;
      }

      const pin = await client.storage.pin(id);

      return { code, pin };
    });

    expect(isolated.code).toBe('corrupt');
    expect(isolated.pin).toEqual(result.published);
  } finally {
    await server.close();
  }
}, 120_000);
