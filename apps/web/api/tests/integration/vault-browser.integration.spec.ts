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
import type { KeyDomain } from '@visomi-stack/shared-db';

import { Access } from '../../src/access/service';
import { OpaqueSync } from '../../src/db/opaque';

import { browserSession, fixture, grant, resource, postgres, policy } from './support/persistence';
import { browserServer, type FixtureHost, type ProtocolBrowser } from './support/browser-server';
import {
  approveBrowserRecipient,
  connectBrowserReplica,
  initializeBrowserVault,
  installBrowserDelivery,
} from './support/browser-vault';

const scenarios = [
  { label: 'different accounts with desktop PRF', sameAccount: false, pinMobile: false, database: 'prf' },
  {
    label: 'one account with desktop PIN and mobile PRF',
    sameAccount: true,
    pinMobile: false,
    database: 'pin_desktop',
  },
  { label: 'one account with mobile PIN and desktop PRF', sameAccount: true, pinMobile: true, database: 'pin_mobile' },
];

describe.each(scenarios)('two browser clients over PostgreSQL ($label)', (scenario) => {
  const { sameAccount, pinMobile, database } = scenario;

  it('enrolls an approved recipient, synchronizes encrypted changes in both directions and audits persisted content', async () => {
    const f = await fixture();

    if (!sameAccount) {
      await grant(f, 'manager');
    }

    const recipientPrincipal = (sameAccount ? f.owner : f.member).actor.principal;
    const recipientSession = await (sameAccount ? browserSession(recipientPrincipal) : f.member.browserAuth);

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
      const owner = await server.client(f.owner.browserAuth.cookie, { prf: !sameAccount, mobileViewport: pinMobile });
      const member = await server.client(recipientSession.cookie, { mobileViewport: sameAccount && !pinMobile });

      expect(recipientSession.cookie).not.toBe(f.owner.browserAuth.cookie);
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
      const laptop = await initializeBrowserVault(owner, {
        key,
        ownerId: f.owner.actor.principal.id,
        csrf: f.owner.browserAuth.csrf,
        path,
        bootstrap: true,
        usePin: sameAccount,
      });
      const recipient = await initializeBrowserVault(member, {
        key,
        ownerId: recipientPrincipal.id,
        csrf: recipientSession.csrf,
        path,
        bootstrap: false,
        usePin: false,
      });
      const { proof } = recipient;

      expect(laptop.method).toBe(sameAccount ? 'pin-argon2id' : 'passkey-prf');
      expect(recipient.method).toBe('passkey-prf');

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

      const read = (browser: ProtocolBrowser) =>
        browser.page.evaluate(async (objectId) => {
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

      const pull = (browser: ProtocolBrowser) =>
        browser.page.evaluate(() => (globalThis as FixtureHost).client.replica!.pull());

      await connectBrowserReplica(owner, 1);

      if (sameAccount) {
        await pull(owner);

        await write(owner, 'SYNTHETIC_WEB_PRIVATE_ONE');
      }

      if (sameAccount) {
        await expect(approveBrowserRecipient(owner, proof, laptop.fingerprint)).rejects.toThrow(
          'synthetic_recipient_fingerprint_mismatch',
        );

        const response = await member.page.request.get(`${server.origin}${path}/devices/${proof.deviceId}/delivery`);

        expect(response.status()).toBe(404);
        const error = await response.json();

        expect(error).toEqual({ error: 'device_delivery_unavailable' });
      }

      // The runner conveys the two fingerprints obtained from the respective local profiles.
      const approver = await approveBrowserRecipient(owner, proof, recipient.fingerprint);
      const { pin } = approver;

      if (sameAccount) {
        await expect(installBrowserDelivery(member, recipient.fingerprint)).rejects.toThrow(
          'synthetic_approver_fingerprint_mismatch',
        );

        await expect(
          member.page.evaluate(() => {
            const { client } = globalThis as FixtureHost;

            return client.vault.unlock(client.binding);
          }),
        ).rejects.toThrow('recovery-required');
      }

      const minimumEpoch = await installBrowserDelivery(member, approver.fingerprint);

      await connectBrowserReplica(member, minimumEpoch);

      for (const browser of [owner, member]) {
        await pull(browser);
      }

      if (!sameAccount) {
        await write(owner, 'SYNTHETIC_WEB_PRIVATE_ONE');

        await expect(write(member, 'SYNTHETIC_WEB_PRIVATE_STALE')).rejects.toThrow('synthetic_sync_rejected');
      }

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

      const observedCipher = await member.page.evaluate(
        async ({ objectId, sameAccount }) => {
          const {
            client,
            modules: { api },
          } = globalThis as FixtureHost;
          const id = api.replicaId(client.binding.ownerId, client.binding.key, client.binding.key.scope);
          const envelope = await (sameAccount
            ? client.storage.unit(id, objectId)
            : client.storage.pending(id).then((pending) => pending?.envelope));

          if (!envelope) {
            throw new Error('synthetic_ciphertext_missing');
          }

          return { nonce: envelope.nonce, ciphertext: envelope.ciphertext };
        },
        { objectId, sameAccount },
      );

      if (sameAccount) {
        const received = await read(member);

        expect(received).toBe('SYNTHETIC_WEB_PRIVATE_ONE');
      } else {
        await pull(member);

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
      }

      await write(member, 'SYNTHETIC_WEB_PRIVATE_TWO');

      await pull(owner);

      if (sameAccount) {
        for (const browser of [owner, member]) {
          await browser.page.evaluate(() => {
            const { client } = globalThis as FixtureHost;

            client.vault.lock();
            client.custody.lock();
          });

          await expect(read(browser)).rejects.toThrow('locked');
        }

        await expect(
          owner.page.evaluate(async () => {
            const { client } = globalThis as FixtureHost;

            client.enterPin?.(false);

            try {
              await client.vault.unlock(client.binding);
            } finally {
              client.enterPin?.(true);
            }
          }),
        ).rejects.toThrow('corrupt');

        for (const browser of [owner, member]) {
          await browser.page.evaluate(async () => {
            const { client } = globalThis as FixtureHost;

            await client.vault.unlock(client.binding);

            await client.custody.unlock();
          });
        }

        const usesPin = await member.page.evaluate(() => Boolean((globalThis as FixtureHost).client.enterPin));

        expect(usesPin).toBe(false);
      }

      for (const browser of [owner, member]) {
        const received = await read(browser);

        expect(received).toBe('SYNTHETIC_WEB_PRIVATE_TWO');
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
        observedCipher.nonce,
        observedCipher.ciphertext,
      ]) {
        expect(observed).not.toContain(forbidden);
      }
      const dump = await runTestCompose(postgres.compose, ['exec', '-T', 'postgres', 'cat', backup]);

      expect(dump.stdout).not.toContain('SYNTHETIC_WEB_PRIVATE_');

      const restoreDatabase = `visomi_cipher_restore_${database}`;

      await resource.pool.query(`CREATE DATABASE ${restoreDatabase}`);

      await runTestCompose(postgres.compose, [
        'exec',
        '-T',
        'postgres',
        'psql',
        '--username',
        'visomi_test',
        '--dbname',
        restoreDatabase,
        '--set',
        'ON_ERROR_STOP=1',
        '--file',
        backup,
      ]);

      const restoredUrl = new URL(postgres.url);

      restoredUrl.pathname = `/${restoreDatabase}`;
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
