import { describe, expect, it } from 'vitest';

import type { PendingWrite } from '../src/lib/sync/replica';

import { browser, prepare, vector, type FixtureWindow } from './support/browser';

describe('actual Chromium expired synchronization horizon', () => {
  it('preserves the trusted pin and exact encrypted outbox on history/operation expiry without resetting or rebasing', async () => {
    const page = await browser.newPage();

    try {
      await prepare(page);

      const result = await page.evaluate(
        async ({ vector }) => {
          const { api, contracts } = (globalThis as FixtureWindow).fixtureModules;
          const store = await api.IndexedDbReplicaStorage.open(indexedDB, crypto.randomUUID());
          const cipher = new api.WebCryptoCipher(crypto);
          const key = await cipher.importDataKey(new Uint8Array(32).fill(7));
          const envelope = await cipher.seal(
            key,
            vector.data.context,
            new TextEncoder().encode('Synthetic verified version'),
          );
          const hash = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(contracts.syncCheckpointMessage(1, null, envelope)),
          );
          const checkpoint = api.encodeBytes(new Uint8Array(hash));
          const empty = await store.pin('synthetic-retention');
          const pin = { cursor: 1, checkpoint, generation: 1, epoch: 1 };

          await store.commit('synthetic-retention', empty, pin, [
            { cursor: 1, checkpoint, previousCheckpoint: null, envelope },
          ]);

          const pendingEnvelope = await cipher.seal(
            key,
            { ...envelope.context, revision: 2, previousCheckpoint: checkpoint },
            new TextEncoder().encode('Synthetic pending version'),
          );
          const operationId = contracts.createOperationId(crypto, Date.now() - 31 * contracts.retentionDayMs);
          const pending: PendingWrite = {
            protocol: 1,
            operationId,
            expectedRevision: 1,
            head: { cursor: 1, checkpoint },
            envelope: pendingEnvelope,
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
          let pullHead: unknown;
          let pushBody: unknown;
          const replica = new api.SyncReplica(
            'synthetic-retention',
            envelope.context.key,
            envelope.context.target,
            store,
            {
              pull: async (head) => {
                pullHead = head;

                throw new Error('sync_history_expired');
              },
              push: async (value) => {
                pushBody = value;

                throw new Error('operation_expired');
              },
            },
            crypto,
            async () => {
              throw new Error('synthetic_unexpected_authentication');
            },
          );

          await replica.enqueue(pending);

          const failures: string[] = [];

          for (const work of [() => replica.pull(), () => replica.flush()]) {
            try {
              await work();
            } catch (error) {
              failures.push((error as Error).message);
            }
          }

          const afterPin = await store.pin('synthetic-retention');
          const afterPending = await store.pending('synthetic-retention');

          store.close();

          return {
            failures,
            pinPreserved: JSON.stringify(pin) === JSON.stringify(afterPin),
            pendingPreserved: JSON.stringify(pending) === JSON.stringify(afterPending),
            requestedHead: pullHead,
            exactRequest: JSON.stringify(pushBody) === JSON.stringify(pending),
            checkpoint,
          };
        },
        { vector },
      );

      expect(result.failures).toEqual(['sync_history_expired', 'operation_expired']);
      expect(result.pinPreserved).toBe(true);
      expect(result.pendingPreserved).toBe(true);
      expect(result.exactRequest).toBe(true);
      expect(result.requestedHead).toEqual({ cursor: 1, checkpoint: result.checkpoint });
    } finally {
      await page.close();
    }
  });
});
