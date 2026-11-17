import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { initializeObservability } from '@visomi-stack/web-backend-shared';
import { createDatabase } from '@visomi-stack/backend-db';
import { runTestCompose } from '@visomi-stack/dev-testing/postgres';
import type { ApprovedDelivery, DeviceProof, KeyDomain, SigningPin } from '@visomi-stack/shared-db';

import { Access } from '../../src/access/service';
import { OpaqueSync } from '../../src/db/opaque';

import { fixture, grant, resource, postgres, policy } from './support/persistence';
import { browserServer, type FixtureHost, type ProtocolBrowser } from './support/browser-server';

describe('two real web clients over authenticated opaque PostgreSQL transport', () => {
  it('enrolls an approved recipient, synchronizes encrypted changes in both directions and audits persisted content', async () => {
    const f = await fixture();

    await grant(f, 'manager');

    const lines: unknown[] = [];
    const spans = new InMemorySpanExporter();
    const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter: metrics, exportIntervalMillis: 60_000 });
    const telemetry = initializeObservability({
      service: 'web-api',
      version: '0.0.1',
      environment: 'test',
      destination: { write: (line) => lines.push(JSON.parse(line)) },
      spanExporter: spans,
      metricReader: reader,
    });
    const server = await browserServer(telemetry);

    try {
      const owner = await server.client(f.owner.browserAuth.cookie);
      const member = await server.client(f.member.browserAuth.cookie);
      const key: KeyDomain = {
        product: 'synthetic-example',
        domain: 'private-resources',
        scope: {
          kind: 'resource',
          tenantId: f.target.tenantId,
          groupId: f.group.scopeId,
          resourceId: f.target.scopeId,
        },
        generation: 1,
      };
      const path = `/api/persistence/tenants/${f.target.tenantId}/scopes/${f.target.scopeId}/domains/private-resources`;
      const initialize = async (client: ProtocolBrowser, ownerId: string, csrf: string, bootstrap: boolean) => {
        const proof = await client.page.evaluate(
          async ({ key, ownerId, csrf, path, bootstrap }) => {
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
            const storage = await api.IndexedDbVaultStorage.open(indexedDB, ownerId);
            const vault = new api.BrowserVault(
              ownerId,
              storage,
              new api.PrfUnlock(environment),
              new api.WebCryptoCipher(crypto),
            );

            if (bootstrap) {
              await vault.initialize(binding);
            }

            const custodyStorage = await api.IndexedDbVaultStorage.open(indexedDB, ownerId);
            const custody = new api.DeviceCustody(custodyStorage, binding, new api.PrfUnlock(environment), crypto);

            await custody.unlock(true);

            const keys = await custody.publicKeys();
            const request = await fetch(`${path}/devices/request`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
              body: JSON.stringify({ deviceId: binding.deviceId, keys }),
            });

            if (!request.ok) {
              throw new Error('synthetic_device_request_failed');
            }

            const raw = await request.json();
            const challenge = await custody.prove(contracts.deviceChallengeSchema.parse(raw));

            if (bootstrap) {
              const registered = await fetch(`${path}/devices/bootstrap`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
                body: JSON.stringify(challenge),
              });

              if (!registered.ok) {
                throw new Error('synthetic_bootstrap_failed');
              }
            }

            const replicaStorage = await api.IndexedDbReplicaStorage.open(indexedDB, ownerId);

            host.client = { binding, vault, custody, challenge, storage: replicaStorage, path, csrf };

            return challenge;
          },
          { key, ownerId, csrf, path, bootstrap },
        );

        return proof;
      };

      await initialize(owner, f.owner.actor.principal.id, f.owner.browserAuth.csrf, true);

      const proof = await initialize(member, f.member.actor.principal.id, f.member.browserAuth.csrf, false);
      const pin = await owner.page.evaluate(async (proof: DeviceProof) => {
        const host = globalThis as FixtureHost;
        const { api, contracts } = host.modules;
        const client = host.client;
        const devices = new api.WebCryptoDevices(crypto);
        const fingerprint = await devices.fingerprint(proof);
        const binding = {
          key: proof.key,
          ownerId: proof.ownerId,
          deviceId: proof.deviceId,
          requestId: proof.requestId,
          challenge: proof.challenge,
          fingerprint,
          encryption: proof.keys.encryption,
        };
        const delivery = await client.vault.deliver(binding, devices);
        const body = { proof: contracts.deviceProofSchema.parse(proof), delivery };
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
        const authorization = await client.custody.sign({
          key: proof.key,
          deviceId: client.binding.deviceId,
          operationId: crypto.randomUUID(),
          epoch: 1,
          action: 'approve',
          bodyHash: api.encodeBytes(new Uint8Array(digest)),
        });
        const approved = await fetch(`${client.path}/devices/approve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': client.csrf },
          body: JSON.stringify({ ...body, authorization }),
        });

        if (!approved.ok) {
          throw new Error('synthetic_approval_failed');
        }

        const keys = await client.custody.publicKeys();

        return { deviceId: client.binding.deviceId, signing: keys.signing };
      }, proof);

      await member.page.evaluate(async (pin: SigningPin) => {
        const { client, modules } = globalThis as FixtureHost;
        const response = await fetch(`${client.path}/devices/${client.binding.deviceId}/delivery`);

        if (!response.ok) {
          throw new Error('synthetic_delivery_failed');
        }

        const raw: ApprovedDelivery = await response.json();
        const challenge = client.challenge;
        const fingerprint = await new modules.api.WebCryptoDevices(crypto).fingerprint(challenge);
        const expected = {
          key: challenge.key,
          ownerId: challenge.ownerId,
          deviceId: challenge.deviceId,
          requestId: challenge.requestId,
          challenge: challenge.challenge,
          fingerprint,
          encryption: challenge.keys.encryption,
        };
        const key = await client.custody.open(expected, raw, pin);

        try {
          await client.vault.install(client.binding, key);
        } finally {
          key.fill(0);
        }
      }, pin);

      for (const client of [owner, member]) {
        await client.page.evaluate(() => {
          const host = globalThis as FixtureHost;
          const {
            client,
            modules: { api },
          } = host;
          const id = api.replicaId(client.binding.ownerId, client.binding.key, client.binding.key.scope);
          const transport = async (path: string, body: unknown, signal: AbortSignal) => {
            const response = await fetch(`${client.path}/sync/${path}`, {
              method: 'POST',
              signal,
              headers: { 'content-type': 'application/json', 'x-csrf-token': client.csrf },
              body: JSON.stringify(body),
            });

            if (!response.ok) {
              throw new Error('synthetic_sync_rejected');
            }

            const result = await response.json();

            return result;
          };

          client.replica = new api.SyncReplica(
            id,
            client.binding.key,
            client.binding.key.scope,
            client.storage,
            {
              pull: (head, signal) => transport('pull', { protocol: 1, head }, signal),
              push: (value, signal) => transport('push', value, signal),
            },
            crypto,
            async (envelope) => {
              const clear = await client.vault.decrypt(envelope.context, envelope);

              clear.fill(0);
            },
          );
        });
      }
      const objectId = randomUUID();
      const write = async (browser: ProtocolBrowser, text: string) => {
        await browser.page.evaluate(
          async ({ objectId, text }) => {
            const {
              client,
              modules: { api, contracts },
            } = globalThis as FixtureHost;
            const id = api.replicaId(client.binding.ownerId, client.binding.key, client.binding.key.scope);
            const pin = await client.storage.pin(id);
            const previous = await client.storage.unit(id, objectId);
            const envelope = await client.vault.encrypt(
              {
                key: client.binding.key,
                target: client.binding.key.scope,
                objectId,
                schemaVersion: 1,
                revision: (previous?.context.revision ?? 0) + 1,
                kind: 'record',
                previousCheckpoint: pin.checkpoint,
              },
              new TextEncoder().encode(text),
            );
            const operationId = contracts.createOperationId(crypto);
            const body = {
              protocol: 1 as const,
              operationId,
              expectedRevision: envelope.context.revision - 1,
              head: { cursor: pin.cursor, checkpoint: pin.checkpoint },
              envelope,
            };
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
            const authorization = await client.custody.sign({
              key: client.binding.key,
              deviceId: client.binding.deviceId,
              operationId,
              epoch: pin.epoch,
              action: 'sync',
              bodyHash: api.encodeBytes(new Uint8Array(digest)),
            });

            await client.replica!.enqueue(contracts.syncWriteSchema.parse({ ...body, authorization }));

            await client.replica!.flush();
          },
          { objectId, text },
        );
      };

      for (const client of [owner, member]) {
        await client.page.evaluate(async () => {
          await (globalThis as FixtureHost).client.replica!.pull();
        });
      }

      await write(owner, 'SYNTHETIC_WEB_PRIVATE_ONE');

      const backup = '/tmp/synthetic-ciphertext-backup.sql';

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

      await expect(write(member, 'SYNTHETIC_WEB_PRIVATE_STALE')).rejects.toThrow('synthetic_sync_rejected');

      const pendingCipher = await member.page.evaluate(async () => {
        const {
          client,
          modules: { api },
        } = globalThis as FixtureHost;
        const pending = await client.storage.pending(
          api.replicaId(client.binding.ownerId, client.binding.key, client.binding.key.scope),
        );

        if (!pending) {
          throw new Error('synthetic_pending_lost');
        }

        return { nonce: pending.envelope.nonce, ciphertext: pending.envelope.ciphertext };
      });

      await member.page.evaluate(async () => {
        await (globalThis as FixtureHost).client.replica!.pull();
      });

      await member.page.evaluate(async () => {
        const {
          client,
          modules: { api },
        } = globalThis as FixtureHost;
        const pending = await client.storage.pending(
          api.replicaId(client.binding.ownerId, client.binding.key, client.binding.key.scope),
        );

        if (!pending) {
          throw new Error('synthetic_pending_lost');
        }

        await client.replica!.resolve(pending.operationId, null);
      });

      await write(member, 'SYNTHETIC_WEB_PRIVATE_TWO');

      await owner.page.evaluate(async () => {
        await (globalThis as FixtureHost).client.replica!.pull();
      });

      for (const browser of [owner, member]) {
        const text = await browser.page.evaluate(async (objectId) => {
          const {
            client,
            modules: { api },
          } = globalThis as FixtureHost;
          const id = api.replicaId(client.binding.ownerId, client.binding.key, client.binding.key.scope);
          const envelope = await client.storage.unit(id, objectId);

          if (!envelope) {
            throw new Error('synthetic_unit_absent');
          }

          const clear = await client.vault.decrypt(envelope.context, envelope);

          try {
            return new TextDecoder().decode(clear);
          } finally {
            clear.fill(0);
          }
        }, objectId);

        expect(text).toBe('SYNTHETIC_WEB_PRIVATE_TWO');
      }
      const stored = await resource.pool.query(
        'SELECT row_to_json(t)::text AS value FROM vault_opaque_events t WHERE tenant_id = $1',
        [f.target.tenantId],
      );

      expect(stored.rows).toHaveLength(2);
      expect(JSON.stringify(stored.rows)).not.toContain('SYNTHETIC_WEB_PRIVATE_');
      const failure = vi
        .spyOn(OpaqueSync.prototype, 'read')
        .mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_EXCEPTION_81c9'));

      try {
        const response = await fetch(`${server.origin}${path}/sync/pull`, {
          method: 'POST',
          headers: {
            cookie: `visomi.sid=${f.owner.browserAuth.cookie}`,
            origin: server.origin,
            'x-csrf-token': f.owner.browserAuth.csrf,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ protocol: 1, head: { cursor: 0, checkpoint: null } }),
        });
        const error = await response.json();

        expect(response.status).toBe(503);
        expect(error).toEqual({ error: 'persistence_unavailable' });
      } finally {
        failure.mockRestore();
      }

      await reader.forceFlush();

      const spanOutput = spans.getFinishedSpans().map((span) => ({
        name: span.name,
        attributes: span.attributes,
        status: span.status,
        events: span.events,
        links: span.links,
      }));

      expect(spanOutput.length).toBeGreaterThan(0);
      expect(metrics.getMetrics().length).toBeGreaterThan(0);
      const observed = JSON.stringify({ lines, spans: spanOutput, metrics: metrics.getMetrics() });

      for (const forbidden of [
        'SYNTHETIC_WEB_PRIVATE_',
        'SYNTHETIC_PRIVATE_EXCEPTION_',
        f.owner.actor.principal.id,
        f.target.tenantId,
        f.target.scopeId,
        f.owner.browserAuth.cookie,
        f.owner.browserAuth.csrf,
        pin.signing,
        proof.keys.encryption,
        proof.requestId,
        pendingCipher.nonce,
        pendingCipher.ciphertext,
      ]) {
        expect(observed).not.toContain(forbidden);
      }
      const dump = await runTestCompose(postgres.compose, ['exec', '-T', 'postgres', 'cat', backup]);

      expect(dump.stdout).not.toContain('SYNTHETIC_WEB_PRIVATE_');

      await resource.pool.query('CREATE DATABASE visomi_cipher_restore_test');

      await runTestCompose(postgres.compose, [
        'exec',
        '-T',
        'postgres',
        'psql',
        '--username',
        'visomi_test',
        '--dbname',
        'visomi_cipher_restore_test',
        '--set',
        'ON_ERROR_STOP=1',
        '--file',
        backup,
      ]);

      const restoredUrl = new URL(postgres.url);

      restoredUrl.pathname = '/visomi_cipher_restore_test';
      const restored = createDatabase(restoredUrl.toString());

      try {
        const currentHead = await owner.page.evaluate(async () => {
          const {
            client,
            modules: { api },
          } = globalThis as FixtureHost;
          const pin = await client.storage.pin(
            api.replicaId(client.binding.ownerId, client.binding.key, client.binding.key.scope),
          );

          return { cursor: pin.cursor, checkpoint: pin.checkpoint };
        });
        const sync = new OpaqueSync(new Access(restored.db, policy));

        await expect(
          sync.read(f.owner.actor, f.target, 'private-resources', { protocol: 1, head: currentHead }),
        ).rejects.toMatchObject({ code: 'sync_rollback_detected' });

        await expect(
          sync.read(f.outsider.actor, f.target, 'private-resources', {
            protocol: 1,
            head: { cursor: 0, checkpoint: null },
          }),
        ).rejects.toMatchObject({ code: 'scope_access_denied' });
      } finally {
        await restored.close();
      }
    } finally {
      await server.close();

      await telemetry.shutdown();
    }
  }, 120_000);
});
