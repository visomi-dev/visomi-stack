import { describe, expect, it } from 'vitest';
import type { DataEnvelope, SyncEvent } from '@visomi-stack/shared-persistence';

import type { PendingWrite } from '../src/lib/replica';

import { browser, prepare, vector, type FixtureWindow } from './support/browser';


describe('actual Chromium ciphertext replicas', () => {
  it('requires an explicit matching operation to rebase or discard a conflicting encrypted outbox', async () => {
    const page = await browser.newPage();

    try {
      await prepare(page);

      const result = await page.evaluate(
        async ({ vector }) => {
          const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
          const storage = await api.IndexedDbReplicaStorage.open(indexedDB, crypto.randomUUID());
          const cipher = new api.WebCryptoCipher(crypto);
          const key = await cipher.importDataKey(new Uint8Array(32).fill(7));
          const context = vector.data.context;
          const local = await cipher.seal(key, context, new TextEncoder().encode('Synthetic pending version'));
          const remote = await cipher.seal(key, context, new TextEncoder().encode('Synthetic remote version'));
          const checkpointBytes = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(contracts.syncCheckpointMessage(1, null, remote)),
          );
          const checkpoint = api.encodeBytes(new Uint8Array(checkpointBytes));
          const pendingFor = (
            envelope: DataEnvelope,
            head = { cursor: 0, checkpoint: null as string | null },
          ): PendingWrite => {
            const operationId = contracts.createOperationId(crypto);

            return {
              protocol: 1,
              operationId,
              expectedRevision: envelope.context.revision - 1,
              head,
              envelope,
              authorization: {
                key: envelope.context.key,
                deviceId: crypto.randomUUID(),
                operationId,
                epoch: 1,
                action: 'sync',
                bodyHash: api.encodeBytes(new Uint8Array(32)),
                signature: api.encodeBytes(new Uint8Array(64)),
              },
            };
          };
          const pending = pendingFor(local);
          const replica = new api.SyncReplica(
            'conflict',
            context.key,
            context.target,
            storage,
            {
              async push() {
                throw new Error('synthetic_conflict');
              },
              async pull() {
                return {
                  protocol: 1,
                  generation: 1,
                  epoch: 1,
                  phase: 'ready',
                  head: { cursor: 1, checkpoint },
                  events: [{ cursor: 1, checkpoint, previousCheckpoint: null, envelope: remote }],
                  more: false,
                };
              },
            },
            crypto,
            async (envelope) => {
              const clear = await cipher.open(key, envelope.context, envelope);

              clear.fill(0);
            },
          );

          await replica.enqueue(pending);

          await replica.pull();

          let wrongOperation = '';

          try {
            await replica.resolve(crypto.randomUUID(), null);
          } catch (error) {
            wrongOperation = (error as { code: string }).code;
          }
          const preserved = await storage.pending('conflict');
          let oldHead = '';

          try {
            await replica.resolve(pending.operationId, pendingFor(local));
          } catch (error) {
            oldHead = (error as { code: string }).code;
          }
          const rebased = await cipher.seal(
            key,
            { ...context, revision: 2, previousCheckpoint: checkpoint },
            new TextEncoder().encode('Synthetic pending version'),
          );
          const replacement = pendingFor(rebased, { cursor: 1, checkpoint });

          await replica.resolve(pending.operationId, replacement);

          const updated = await storage.pending('conflict');

          await replica.resolve(replacement.operationId, null);

          const empty = await storage.pending('conflict');
          const current = await storage.unit('conflict', context.objectId);

          storage.close();

          return {
            wrongOperation,
            preserved: preserved?.operationId === pending.operationId,
            oldHead,
            replaced: updated?.operationId === replacement.operationId,
            discarded: empty === undefined,
            synchronizedCiphertextPreserved: current?.ciphertext === remote.ciphertext,
          };
        },
        { vector },
      );

      expect(result).toEqual({
        wrongOperation: 'revision-conflict',
        preserved: true,
        oldHead: 'revision-conflict',
        replaced: true,
        discarded: true,
        synchronizedCiphertextPreserved: true,
      });
    } finally {
      await page.close();
    }
  });
  it('authenticates history before atomic pins, propagates tombstones and rejects rollback/corruption across restart', async () => {
    const page = await browser.newPage();

    try {
      await prepare(page);

      const result = await page.evaluate(
        async ({ vector }) => {
          const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
          const cipher = new api.WebCryptoCipher(crypto);
          const key = await cipher.importDataKey(new Uint8Array(32).fill(7));
          const base = vector.data.context;
          const owner = crypto.randomUUID();
          const firstStore = await api.IndexedDbReplicaStorage.open(indexedDB, owner);
          const secondStore = await api.IndexedDbReplicaStorage.open(indexedDB, crypto.randomUUID());
          const events: SyncEvent[] = [];

          for (const kind of ['record', 'tombstone'] as const) {
            const previous = events.at(-1)?.checkpoint ?? null;
            const context = { ...base, revision: events.length + 1, kind, previousCheckpoint: previous };
            const envelope = await cipher.seal(
              key,
              context,
              new TextEncoder().encode(kind === 'record' ? 'Synthetic private replica' : ''),
            );
            const digest = await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(contracts.syncCheckpointMessage(events.length + 1, previous, envelope)),
            );
            const checkpoint = api.encodeBytes(new Uint8Array(digest));

            events.push({ cursor: events.length + 1, checkpoint, previousCheckpoint: previous, envelope });
          }
          const head = { cursor: 2, checkpoint: events[1].checkpoint };
          let corrupt = true;
          let rollback = false;
          const transport = {
            async pull(pin: { cursor: number }) {
              const remaining = events.filter((event) => event.cursor > pin.cursor).slice(0, 1);
              const page = {
                protocol: 1,
                generation: 1,
                epoch: 1,
                phase: 'ready',
                head: rollback ? { cursor: 0, checkpoint: null } : head,
                events: remaining,
                more: remaining.at(-1)?.cursor === 1,
              };

              if (corrupt && remaining[0]) {
                return { ...page, events: [{ ...remaining[0], checkpoint: api.encodeBytes(new Uint8Array(32)) }] };
              }

              return page;
            },
            async push() {
              throw new Error('synthetic_offline');
            },
          };
          const authenticate = async (envelope: DataEnvelope) => {
            const clear = await cipher.open(key, envelope.context, envelope);

            clear.fill(0);
          };
          const first = new api.SyncReplica(
            'synthetic-stream',
            base.key,
            base.target,
            firstStore,
            transport,
            crypto,
            authenticate,
          );
          let corruptCode = '';

          try {
            await first.pull();
          } catch (error) {
            corruptCode = (error as { code: string }).code;
          }
          const unchanged = await firstStore.pin('synthetic-stream');

          corrupt = false;
          const part = await first.pull();

          await first.pull();

          const second = new api.SyncReplica(
            'synthetic-stream',
            base.key,
            base.target,
            secondStore,
            transport,
            crypto,
            authenticate,
          );

          await second.pull();

          await second.pull();

          const unit = await secondStore.unit('synthetic-stream', base.objectId);

          firstStore.close();
          const reopened = await api.IndexedDbReplicaStorage.open(indexedDB, owner);
          const pin = await reopened.pin('synthetic-stream');
          const restarted = new api.SyncReplica(
            'synthetic-stream',
            base.key,
            base.target,
            reopened,
            transport,
            crypto,
            authenticate,
          );

          rollback = true;
          let rollbackCode = '';

          try {
            await restarted.pull();
          } catch (error) {
            rollbackCode = (error as { code: string }).code;
          }
          const otherConnection = await api.IndexedDbReplicaStorage.open(indexedDB, owner);
          const next = { ...pin, epoch: pin.epoch + 1 };
          const races = await Promise.allSettled([
            reopened.commit('synthetic-stream', pin, next, []),
            otherConnection.commit('synthetic-stream', pin, next, []),
          ]);
          const storedWire = JSON.stringify(unit);

          reopened.close();
          otherConnection.close();
          secondStore.close();

          return {
            corruptCode,
            unchanged,
            firstMore: part.more,
            pin,
            tombstone: unit?.context.kind,
            rollbackCode,
            writes: races.map((item) => item.status),
            plaintextPersisted: storedWire.includes('Synthetic private replica'),
          };
        },
        { vector },
      );

      expect(result).toMatchObject({
        corruptCode: 'integrity-failure',
        unchanged: { cursor: 0, checkpoint: null },
        firstMore: true,
        pin: { cursor: 2 },
        tombstone: 'tombstone',
        rollbackCode: 'context-mismatch',
        plaintextPersisted: false,
      });
      expect(result.writes.sort()).toEqual(['fulfilled', 'rejected']);
    } finally {
      await page.close();
    }
  });

  it('retains ciphertext outbox while offline or unobserved, and removes it only after exact authenticated history', async () => {
    const page = await browser.newPage();

    try {
      await prepare(page);

      const result = await page.evaluate(
        async ({ vector }) => {
          const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
          const storage = await api.IndexedDbReplicaStorage.open(indexedDB, crypto.randomUUID());
          const cipher = new api.WebCryptoCipher(crypto);
          const key = await cipher.importDataKey(new Uint8Array(32).fill(7));
          const context = vector.data.context;
          const envelope = await cipher.seal(key, context, new TextEncoder().encode('Synthetic queued payload'));
          const digest = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(contracts.syncCheckpointMessage(1, null, envelope)),
          );
          const checkpoint = api.encodeBytes(new Uint8Array(digest));
          const operationId = contracts.createOperationId(crypto);
          const pending: PendingWrite = {
            protocol: 1,
            operationId,
            expectedRevision: 0,
            head: { cursor: 0, checkpoint: null },
            envelope,
            authorization: {
              key: context.key,
              deviceId: crypto.randomUUID(),
              operationId,
              epoch: 1,
              action: 'sync',
              bodyHash: api.encodeBytes(new Uint8Array(32)),
              signature: api.encodeBytes(new Uint8Array(64)),
            },
          };
          let offline = true;
          let present = false;
          let pushes = 0;
          const transport = {
            async push(value: PendingWrite) {
              pushes++;

              if (offline) {
                throw new Error('synthetic_offline');
              }

              if (JSON.stringify(value) !== JSON.stringify(contracts.syncWriteSchema.parse(pending))) {
                throw new Error('synthetic_changed_retry');
              }

              return { cursor: 1, checkpoint };
            },
            async pull(head: { cursor: number }) {
              return {
                protocol: 1,
                generation: 1,
                epoch: 1,
                phase: 'ready',
                head: present ? { cursor: 1, checkpoint } : { cursor: 0, checkpoint: null },
                events:
                  present && head.cursor === 0 ? [{ cursor: 1, checkpoint, previousCheckpoint: null, envelope }] : [],
                more: false,
              };
            },
          };
          const replica = new api.SyncReplica(
            'queue',
            context.key,
            context.target,
            storage,
            transport,
            crypto,
            async (envelope) => {
              const clear = await cipher.open(key, envelope.context, envelope);

              clear.fill(0);
            },
          );

          await replica.enqueue(pending);

          try {
            await replica.flush();
          } catch {
            /* Synthetic network outage. */
          }
          const offlinePending = await storage.pending('queue');

          offline = false;
          let unobserved = '';

          try {
            await replica.flush();
          } catch (error) {
            unobserved = (error as { code: string }).code;
          }
          const unobservedPending = await storage.pending('queue');

          present = true;

          await replica.flush();

          const empty = await storage.pending('queue');
          const pin = await storage.pin('queue');

          storage.close();

          return {
            offlinePresent: Boolean(offlinePending),
            unobserved,
            unobservedPresent: Boolean(unobservedPending),
            cleared: empty === undefined,
            pin,
            pushes,
          };
        },
        { vector },
      );

      expect(result).toMatchObject({
        offlinePresent: true,
        unobserved: 'corrupt',
        unobservedPresent: true,
        cleared: true,
        pin: { cursor: 1 },
        pushes: 3,
      });
    } finally {
      await page.close();
    }
  });
});
