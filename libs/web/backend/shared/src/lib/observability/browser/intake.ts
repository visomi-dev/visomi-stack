import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Router, json } from 'express';
import type { RequestHandler, ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { rateLimit, MemoryStore } from 'express-rate-limit';

import type { Observability } from '../lib/observability';
import type { Correlation } from '../lib/policy';

import type { BrowserAssets } from './assets';

import { applications, browserErrorCodes, browserErrorKinds, screens } from '@visomi-stack/web-shared-observability';
import type { BrowserErrorReport } from '@visomi-stack/web-shared-observability';

const reportSchema = z.strictObject({
  application: z.enum(applications),
  code: z.enum(browserErrorCodes),
  kind: z.enum(browserErrorKinds),
  screen: z.enum(screens),
  location: z
    .strictObject({
      asset: z.string().regex(/^[a-f0-9]{64}$/),
      line: z.number().int().min(1).max(1000000),
      column: z.number().int().min(1).max(1000000),
    })
    .optional(),
  correlation: z.string().max(1024).optional(),
});
const tokenSchema = z.strictObject({
  purpose: z.enum(['report', 'correlate']),
  expires: z.number().int(),
  context: z
    .strictObject({
      requestId: z.uuidv4(),
      traceId: z.string().regex(/^[a-f0-9]{32}$/),
      spanId: z.string().regex(/^[a-f0-9]{16}$/),
    })
    .optional(),
});

export function createBrowserTelemetry(options: {
  observability: Observability;
  assets: Partial<Record<BrowserErrorReport['application'], BrowserAssets>>;
  origin: string;
  now?: () => number;
}): { context: RequestHandler; router: Router; close: () => void } {
  const origin = new URL(options.origin).origin;
  const now = options.now ?? Date.now;
  const secret = randomBytes(32);
  const releases = new Map(
    Object.entries(options.assets).map(([application, assets]) => [
      application,
      createHash('sha256')
        .update([...assets.keys()].sort().join(','))
        .digest('hex'),
    ]),
  );
  const router = Router();
  const store = new MemoryStore();

  function sign(purpose: 'report' | 'correlate', context?: Correlation): string {
    const body = Buffer.from(
      JSON.stringify({ purpose, expires: now() + 300000, ...(context ? { context } : {}) }),
    ).toString('base64url');

    return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
  }

  function verify(value: unknown, purpose: 'report' | 'correlate') {
    if (typeof value !== 'string' || value.length > 1024) {
      return;
    }

    const parts = value.split('.');

    if (parts.length !== 2) {
      return;
    }

    const expected = createHmac('sha256', secret).update(parts[0]).digest();
    const received = Buffer.from(parts[1], 'base64url');

    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      return;
    }

    try {
      const result = tokenSchema.safeParse(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')));

      return result.success && result.data.purpose === purpose && result.data.expires > now() ? result.data : undefined;
    } catch {
      return;
    }
  }

  const context: RequestHandler = (request, response, next) => {
    const ids = options.observability.correlation();

    if (ids && (request.path === '/api' || request.path.startsWith('/api/'))) {
      response.setHeader('x-telemetry-context', sign('correlate', ids));
    }

    next();
  };

  router.use((_request, response, next) => {
    response.setHeader('cache-control', 'no-store');
    next();
  });
  router.use(
    rateLimit({
      windowMs: 60000,
      limit: 120,
      store,
      // One fixed bucket bounds traffic without retaining addresses or browser identifiers.
      keyGenerator: () => 'global',
      standardHeaders: false,
      legacyHeaders: false,
      message: { error: 'telemetry_limited' },
    }),
  );
  router.get('/config', (_request, response) =>
    response.json({
      token: sign('report'),
      assets: Object.values(options.assets).flatMap((assets) =>
        [...assets].flatMap(([id, asset]) => asset.paths.map((path) => ({ id, path }))),
      ),
    }),
  );
  router.post(
    '/errors',
    (request, response, next) => {
      if (
        request.get('origin') !== origin ||
        !request.is('application/json') ||
        !verify(request.get('x-browser-telemetry'), 'report')
      ) {
        response.status(403).json({ error: 'telemetry_denied' });

        return;
      }

      next();
    },
    json({ limit: '2kb', strict: true, inflate: false }),
    (request, response) => {
      const parsed = reportSchema.safeParse(request.body);

      if (!parsed.success || !options.assets[parsed.data.application]) {
        response.status(400).json({ error: 'telemetry_invalid' });

        return;
      }

      const { correlation, location, ...report } = parsed.data;
      const assets = options.assets[report.application]!;

      if (location) {
        const asset = assets.get(location.asset);
        const columns = asset?.lines[location.line - 1];

        if (columns === undefined || location.column > columns + 1) {
          response.status(400).json({ error: 'telemetry_invalid' });

          return;
        }
      }

      const parent = verify(correlation, 'correlate')?.context;

      options.observability.frontendError(
        {
          ...report,
          ...(location ? { location } : {}),
          release: location ? releases.get(report.application)! : 'unknown',
        },
        parent,
      );
      response.sendStatus(202);
    },
  );
  // Parser errors must not expose payloads, decompression details or validation messages.
  router.use(((_error, _request, response, _next) => {
    response.status(400).json({ error: 'telemetry_invalid' });
  }) satisfies ErrorRequestHandler);

  return { context, router, close: () => store.shutdown() };
}
