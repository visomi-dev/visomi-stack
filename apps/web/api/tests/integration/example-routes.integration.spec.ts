import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { developmentPersistenceDemos } from '@visomi-stack/shared-db';
import express from 'express';
import { expect, it } from 'vitest';

import { authConfig, createApp, createAuthentication } from '../../src/app';

import { browserSession, client, resource, syntheticPersistenceSecret } from './support/persistence';

it('keeps authenticated production examples under exactly one mount prefix and fails closed without backing storage', async () => {
  const host = express();
  const server = createServer(host);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = createAuthentication({
      database: resource.db,
      pool: resource.pool,
      config: authConfig({ origin, rpId: '127.0.0.1', secret: syntheticPersistenceSecret }),
    });
    const exampleHarness = developmentPersistenceDemos({
      NODE_ENV: 'production',
      VISOMI_PERSISTENCE_EXAMPLE: 'true',
      VISOMI_PERSISTENCE_DEMOS: 'true',
    });

    host.use('/api', auth.middleware, createApp({ auth, exampleHarness, authMode: 'inherited', basePath: '/api' }));
    host.use(createApp({ auth, exampleHarness }));

    const actor = await client();
    const limited = await browserSession({ ...actor.actor.principal, level: 'unverified' });
    const headers = {
      cookie: `visomi.sid=${actor.browserAuth.cookie}`,
      origin,
      'x-csrf-token': actor.browserAuth.csrf,
      'content-type': 'application/json',
    };
    const send = (path: string, body?: unknown) =>
      fetch(`${origin}${path}`, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

    for (const prefix of ['', '/api']) {
      for (const [slug, product] of [
        ['vault', 'synthetic-example'],
        ['cloud', 'synthetic-cloud-example'],
      ]) {
        const path = `${prefix}/example/${slug}/policy`;
        const anonymous = await fetch(`${origin}${path}`);
        const unverified = await fetch(`${origin}${path}`, { headers: { cookie: `visomi.sid=${limited.cookie}` } });
        const response = await send(path);
        const document = await response.json();

        expect(anonymous.status).toBe(401);
        expect(unverified.status).toBe(403);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(document).toMatchObject({ policy: { product } });
        expect(document).not.toHaveProperty('hybridHarness');
        expect(document).not.toHaveProperty('objectBackups');
      }

      for (const path of [
        '/persistence/policy',
        '/persistence/cloud-example/policy',
        '/vault-example/policy',
        '/cloud-example/policy',
      ]) {
        const old = await send(`${prefix}${path}`);

        expect(old.status).toBe(404);
      }

      const unavailable = await send(`${prefix}/example/vault/tenants`, {});

      expect(unavailable.status).toBe(503);

      await expect(unavailable.json()).resolves.toEqual({ error: 'vault_backup_unavailable' });

      const tenant = await send(`${prefix}/example/cloud/tenants`, {});
      const tenantBody = await tenant.json();
      const target = tenantBody as { tenantId: string; scopeId: string };

      expect(tenant.status).toBe(200);

      const vault = `${prefix}/example/vault/tenants/${target.tenantId}/scopes/${target.scopeId}`;
      const declinedInline = await send(`${vault}/children`, { kind: 'resource' });
      const missingObjects = await send(`${vault}/children`, { kind: 'resource', objectBackup: true });

      expect(declinedInline.status).toBe(403);
      expect(missingObjects.status).toBe(503);

      const harnessRecords = await send(`${vault}/domains/operations/records`);

      expect(harnessRecords.status).toBe(404);

      const child = await send(`${prefix}/example/cloud/tenants/${target.tenantId}/scopes/${target.scopeId}/children`, {
        kind: 'resource',
      });
      const childBody = await child.json();
      const resourceScope = childBody as { scopeId: string };

      expect(child.status).toBe(200);

      const base = `${prefix}/example/cloud/tenants/${target.tenantId}/scopes/${resourceScope.scopeId}`;
      const deniedRecordFallback = await send(`${base}/domains/cloud-notes/records`);

      expect(deniedRecordFallback.status).toBe(503);

      await expect(deniedRecordFallback.json()).resolves.toEqual({ error: 'persistence_unavailable' });

      const specs = await send(`${prefix}/openapi.json`);
      const specBody = await specs.json();
      const spec = specBody as { servers: { url: string }[]; paths: Record<string, unknown> };

      expect(spec.servers).toEqual([{ url: prefix || '/' }]);
      expect(Object.keys(spec.paths)).toEqual(
        expect.arrayContaining(['/example/vault/policy', '/example/cloud/policy']),
      );
      expect(Object.keys(spec.paths).some((path) => path.startsWith('/persistence') || path.startsWith('/api'))).toBe(
        false,
      );
      expect(
        Object.keys(spec.paths).some((path) => path.startsWith('/example/vault/') && path.endsWith('/records')),
      ).toBe(false);
      expect(
        Object.keys(spec.paths).some((path) => path.startsWith('/example/cloud/') && path.endsWith('/devices')),
      ).toBe(false);
    }

    const doublePrefix = await send('/api/api/example/vault/policy');

    expect(doublePrefix.status).toBe(404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
