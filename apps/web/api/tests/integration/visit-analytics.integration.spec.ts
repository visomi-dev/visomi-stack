import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testPostgres } from '@visomi-stack/dev-testing';
import { createVisitAnalytics, type VisitAnalytics } from '@visomi-stack/web-backend-shared';

const origin = 'https://synthetic.example.test';
let postgres: Awaited<ReturnType<typeof testPostgres>> | undefined;
let pool: Pool | undefined;

beforeAll(async () => {
  const started = await testPostgres();

  postgres = started;
  pool = new Pool({ connectionString: postgres.url });
}, 60_000);

afterAll(async () => {
  await pool?.end();

  await postgres?.stop();
}, 60_000);

it('records bounded anonymous page views, survives a new receiver and expires old daily counts', async () => {
  const options = { enabled: true, pool: pool!, site: 'synthetic', origin, pages: ['home', 'docs'] };
  const service = createVisitAnalytics(options);

  await withReceiver(service, async (url) => {
    const send = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(url, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });

    const status = await fetch(url + '/config');

    const config = await status.json();

    expect(config).toEqual({ enabled: true });
    expect(status.headers.get('cache-control')).toBe('no-store');
    const empty = await service.summary(7);

    expect(empty).toMatchObject({ state: 'ready', days: [] });

    await pool!.query(`INSERT INTO site_visit_days (site, day, page, locale, views)
      VALUES ('synthetic', (now() AT TIME ZONE 'UTC')::date - 90, 'home', 'en', 90),
             ('synthetic', (now() AT TIME ZONE 'UTC')::date - 8, 'home', 'en', 4),
             ('separate-site', (now() AT TIME ZONE 'UTC')::date, 'home', 'en', 100)`);

    const page = { page: 'home', locale: 'en' };

    const responses = await Promise.all([
      send(page),
      send(page),
      send({ page: 'docs', locale: 'es' }),
      send({ page: 'unknown', locale: 'en' }),
      send({ ...page, url: '/private?token=synthetic' }),
      send(page, { origin: 'https://denied.example.test' }),
      send(page, { 'sec-gpc': '1' }),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([204, 204, 204, 400, 400, 403, 204]);
    const restarted = createVisitAnalytics(options);

    try {
      const summary = await restarted.summary(7);

      expect(summary).toMatchObject({
        state: 'ready',
        days: [
          { page: 'docs', locale: 'es', views: 1 },
          { page: 'home', locale: 'en', views: 2 },
          { page: 'home', locale: 'en', views: 4 },
        ],
      });
    } finally {
      restarted.close();
    }

    const history = await pool!.query('SELECT views::integer AS views FROM site_visit_days ORDER BY views');

    expect(history.rows.map((row) => row.views)).toEqual([1, 2, 4, 100]);
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
