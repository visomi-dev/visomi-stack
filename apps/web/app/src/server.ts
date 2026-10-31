import { resolve } from 'node:path';

import { AngularNodeAppEngine, createNodeRequestHandler, writeResponseToNodeResponse } from '@angular/ssr/node';
import express, { static as serveStatic } from 'express';

import {
  type Observability,
  type createBrowserTelemetry,
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
  } = {},
) {
  const app = express();

  app.disable('x-powered-by');

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
  app.use((request, response, next) => {
    if (request.path !== '/app' && !request.path.startsWith('/app/')) {
      next();

      return;
    }

    engine ??= new AngularNodeAppEngine();

    engine
      .handle(request)
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

  if ((options.errorMode ?? 'managed') === 'managed') {
    app.use(httpErrorHandler);
  }

  return app;
}

// Angular's build and development server consume this handler without starting a process runtime.
export const reqHandler = createNodeRequestHandler(createApp());
