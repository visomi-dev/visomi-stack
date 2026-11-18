import { Router, json, type ErrorRequestHandler } from 'express';
import { MemoryStore, rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { z } from 'zod';

import type { VisitCount, VisitPeriod, VisitSummary } from '@visomi-stack/web-shared-observability';

const utcDay = "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date";
const retentionDays = 90;
const unavailable = { state: 'unavailable' } as const;
const input = z.strictObject({ page: z.string().max(40), locale: z.enum(['en', 'es']) });

export type VisitAnalytics = {
  router: Router;
  summary: (period: VisitPeriod) => Promise<VisitSummary>;
  close: () => void;
};

export function createVisitAnalytics(options: {
  enabled: boolean;
  pool?: Pick<Pool, 'query'>;
  site: string;
  origin: string;
  pages: readonly string[];
}): VisitAnalytics {
  const { enabled, pool, site } = options;
  const router = Router();
  const store = new MemoryStore();

  router.use((_request, response, next) => {
    response.set('cache-control', 'no-store');
    next();
  });
  router.get('/config', (_request, response) => response.json({ enabled: enabled && Boolean(pool) }));
  router.post(
    '/',
    (request, response, next) => {
      if (!enabled || request.get('sec-gpc') === '1' || request.get('dnt') === '1') {
        response.sendStatus(204);
      } else if (!pool) {
        response.sendStatus(503);
      } else if (request.get('origin') !== options.origin || !request.is('application/json')) {
        response.sendStatus(403);
      } else {
        next();
      }
    },
    rateLimit({
      store,
      windowMs: 60_000,
      limit: 120,
      keyGenerator: () => 'visits',
      standardHeaders: false,
      legacyHeaders: false,
    }),
    json({ limit: '256b', strict: true, inflate: false }),
    async (request, response) => {
      const visit = input.safeParse(request.body);

      if (!visit.success || !options.pages.includes(visit.data.page)) {
        response.sendStatus(400);

        return;
      }

      try {
        await pool!.query(
          `WITH expired AS (DELETE FROM site_visit_days WHERE site = $1 AND day <= ${utcDay} - $4::integer)
           INSERT INTO site_visit_days (site, day, page, locale, views) VALUES ($1, ${utcDay}, $2, $3, 1)
           ON CONFLICT (site, day, page, locale) DO UPDATE SET views = site_visit_days.views + 1`,
          [site, visit.data.page, visit.data.locale, retentionDays],
        );

        response.sendStatus(204);
      } catch {
        response.sendStatus(503);
      }
    },
  );
  const safeError: ErrorRequestHandler = (_error, _request, response, _next) => {
    response.sendStatus(400);
  };

  router.use(safeError);

  async function summary(period: VisitPeriod): Promise<VisitSummary> {
    if (!enabled) {
      return { state: 'disabled' };
    }

    if (!pool) {
      return unavailable;
    }

    try {
      const { rows } = await pool.query<{ first_day: string; days: VisitCount[] }>(
        `SELECT to_char(${utcDay} - $2::integer + 1, 'YYYY-MM-DD') AS first_day,
           COALESCE(json_agg(json_build_object('day', day, 'page', page, 'locale', locale, 'views', views)
             ORDER BY day DESC, page, locale), '[]') AS days
           FROM site_visit_days WHERE site = $1
             AND day >= ${utcDay} - (2 * $2::integer) + 1 AND day <= ${utcDay}`,
        [site, period],
      );

      return { state: 'ready', period, firstDay: rows[0].first_day, days: rows[0].days };
    } catch {
      return unavailable;
    }
  }

  return { router, summary, close: () => store.shutdown() };
}
