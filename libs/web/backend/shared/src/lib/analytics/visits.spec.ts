import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { Pool } from 'pg';
import { expect, it, vi } from 'vitest';

import { createVisitAnalytics, type VisitAnalytics } from './visits';

const origin = 'https://synthetic.example.test';

it('validates intake before the persistence boundary and returns only aggregate query results', async () => {
  const days = [{ day: '2026-11-17', page: 'home', locale: 'en', views: 3 }];
  const query = vi.fn().mockResolvedValue({ rows: [{ first_day: '2026-11-11', days }] });
  const pool = { query } as Pick<Pool, 'query'>;
  const service = createVisitAnalytics({ enabled: true, pool, site: 'synthetic', origin, pages: ['home'] });
  const summary = await service.summary(7);

  expect(summary).toEqual({ state: 'ready', period: 7, firstDay: '2026-11-11', days });

  await withReceiver(service, async (url) => {
    const configuration = await fetch(url + '/config');
    const payload = await configuration.json();
    const send = (body: object, headers: Record<string, string> = {}) =>
      fetch(url, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    const page = { page: 'home', locale: 'en' };
    const accepted = await send(page);
    const unknown = await send({ page: 'other', locale: 'en' });
    const privateFields = await send({ ...page, path: '/private' });
    const optedOut = await send(page, { 'sec-gpc': '1' });
    const originDenied = await send(page, { origin: 'https://denied.example.test' });

    expect(payload).toEqual({ enabled: true });
    expect(configuration.headers.get('cache-control')).toBe('no-store');
    expect([accepted.status, unknown.status, privateFields.status, optedOut.status, originDenied.status]).toEqual([
      204, 400, 400, 204, 403,
    ]);
    expect(query.mock.calls.map(([, values]) => values)).toEqual([
      ['synthetic', 7],
      ['synthetic', 'home', 'en', 90],
    ]);
  });
});

it('keeps disabled dispatch inert and reports an unavailable database without forwarding errors', async () => {
  const options = { enabled: true, site: 'synthetic', origin, pages: ['home'] };
  const disabled = createVisitAnalytics({ ...options, enabled: false });
  const missing = createVisitAnalytics(options);
  const closed = new Pool({ connectionString: 'postgresql://synthetic@127.0.0.1:1/unused' });

  await closed.end();

  const failing = createVisitAnalytics({ ...options, pool: closed });
  const disabledSummary = await disabled.summary(7);
  const missingSummary = await missing.summary(7);
  const failingSummary = await failing.summary(30);

  expect(disabledSummary).toEqual({ state: 'disabled' });
  expect(missingSummary).toEqual({ state: 'unavailable' });
  expect(failingSummary).toEqual({ state: 'unavailable' });
  const post = { method: 'POST', headers: { origin, 'content-type': 'application/json' } };

  await withReceiver(disabled, async (url) => {
    const ignored = await fetch(url, { ...post, body: '{' });
    const config = await fetch(url + '/config');
    const payload = await config.json();

    expect(ignored.status).toBe(204);
    expect(payload).toEqual({ enabled: false });
  });

  await withReceiver(missing, async (url) => {
    const missing = await fetch(url, post);

    expect(missing.status).toBe(503);
  });

  await withReceiver(failing, async (url) => {
    const body = JSON.stringify({ page: 'home', locale: 'en' });
    const failed = await fetch(url, { ...post, body });
    const malformed = await fetch(url, { ...post, body: '{' });
    const optOut = await fetch(url, { ...post, headers: { ...post.headers, dnt: '1' }, body });
    const nonJson = await fetch(url, { ...post, headers: { origin }, body });

    expect([failed.status, malformed.status, optOut.status, nonJson.status]).toEqual([503, 400, 204, 403]);
  });
});

async function withReceiver(service: VisitAnalytics, check: (url: string) => Promise<void>): Promise<void> {
  const app = express();

  app.use(service.router);
  const server = createServer(app);

  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    await check(url);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));

    service.close();
  }
}
