import { createHmac, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { AngularNodeAppEngine, createNodeRequestHandler, writeResponseToNodeResponse } from '@angular/ssr/node';
import express, { Router, static as serveStatic } from 'express';
import type { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

import type { AuthRenderContext } from './app/auth/session/models';

import {
  type Observability,
  type createBrowserTelemetry,
  HttpError,
  httpErrorHandler,
  httpObservability,
  securityHeaders,
} from '@visomi-stack/web-backend-shared';

export const clientDirectory = resolve(import.meta.dirname, '../browser');
let engine: AngularNodeAppEngine | undefined;

export function createApp(
  options: {
    observability?: Observability;
    browserTelemetry?: Pick<ReturnType<typeof createBrowserTelemetry>, 'context' | 'router'>;
    errorMode?: 'managed' | 'inherited';
    helmetMode?: 'managed' | 'inherited';
    trustProxy?: string[];
    authContext?: (request: Request) => AuthRenderContext;
  } = {},
) {
  const app = express();

  app.disable('x-powered-by');

  if (options.trustProxy) {
    app.set('trust proxy', options.trustProxy);
  }

  if (options.observability) {
    app.use(httpObservability(options.observability));
  }

  if ((options.helmetMode ?? 'managed') === 'managed') {
    app.use(securityHeaders({ nonce: true }));
  }

  if (options.browserTelemetry) {
    app.use(options.browserTelemetry.context);
    app.use('/telemetry', options.browserTelemetry.router);
  }

  app.get('/telemetry/config', (_request, response) =>
    response.set('cache-control', 'no-store').json({ enabled: false }),
  );

  app.use((request, response, next) => {
    let path: string;

    try {
      path = decodeURIComponent(request.path).toLowerCase();
    } catch {
      response.status(400).json({ error: 'request_invalid' });

      return;
    }

    if (path.endsWith('.map')) {
      response.status(404).json({ error: 'not_found' });

      return;
    }

    next();
  });

  app.get(['/app', '/app/'], (_request, response) => response.redirect(302, '/app/en/'));
  const serveAssets = serveStatic(clientDirectory, { index: false, redirect: false });

  app.use('/app', (request, response, next) => {
    // The preceding guard validates encoding; HTML must pass through Angular and nonce substitution.
    if (decodeURIComponent(request.path).toLowerCase().endsWith('.html')) {
      next();

      return;
    }

    serveAssets(request, response, next);
  });
  const key = randomBytes(32);
  const limits = {
    windowMs: 60_000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_request, _response, next) => next(new HttpError(429, 'rate_limited')),
    logger: { error: () => undefined, warn: () => undefined },
  } satisfies Parameters<typeof rateLimit>[0];

  const documents = Router();

  documents.use((request, response, next) => {
    if (!/^\/app\/(?:en|es)(?:\/|$)/.test(request.path)) {
      next('router');

      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.set('allow', 'GET, HEAD');
      next(new HttpError(405, 'method_not_allowed'));

      return;
    }

    const destination = request.get('sec-fetch-dest');

    if ((destination && !['document', 'frame', 'iframe'].includes(destination)) || !request.accepts('html')) {
      next('router');

      return;
    }

    next();
  });

  documents.use(
    rateLimit({
      ...limits,
      limit: 60,
      // Scope transient counters without retaining the client's network address.
      keyGenerator: (request) =>
        createHmac('sha256', key)
          .update(ipKeyGenerator(request.ip ?? 'unknown'))
          .digest('hex'),
    }),
    rateLimit({ ...limits, limit: 600, keyGenerator: () => 'ssr' }),
  );

  documents.use((request, response, next) => {
    engine ??= new AngularNodeAppEngine();

    engine
      .handle(request, { auth: options.authContext?.(request) ?? { available: false, session: null } })
      .then(async (rendered) => {
        if (!rendered) {
          next();

          return;
        }

        const nonce = response.locals['cspNonce'] as string | undefined;

        if (nonce && rendered.headers.get('content-type')?.includes('text/html')) {
          // Angular also stamps the build-time nonce into its early hydration bootstrap script.
          const html = await rendered.text();
          const headers = new Headers(rendered.headers);

          headers.delete('content-length');
          headers.delete('etag');
          headers.set('cache-control', 'no-store');
          rendered = new Response(html.replace(/__VISOMI_CSP_NONCE__/g, nonce), {
            status: rendered.status,
            statusText: rendered.statusText,
            headers,
          });
        }

        await writeResponseToNodeResponse(rendered, response);
      })
      .catch(next);
  });

  app.use(documents);

  if ((options.errorMode ?? 'managed') === 'managed') {
    app.use(httpErrorHandler);
  }

  return app;
}

// Angular's build and development server consume this handler without starting a process runtime.
let defaultApp: Parameters<typeof createNodeRequestHandler>[0] | undefined;

export const reqHandler = createNodeRequestHandler((request, response, next) => {
  defaultApp ??= createApp();

  defaultApp(request, response, next);
});
