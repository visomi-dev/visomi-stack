import {
  httpErrorHandler,
  type createBrowserTelemetry,
  httpObservability,
  securityHeaders,
  type Observability,
} from '@visomi-stack/web-backend-shared';
import express, { static as serveStatic } from 'express';

import type { ApiModule, EmbeddedAuthentication } from './api-module';
import type { SiteModule } from './site-module';

export function createGatewayApp(options: {
  api: ApiModule;
  site?: SiteModule;
  auth?: EmbeddedAuthentication;
  observability?: Observability;
  browserTelemetry?: Pick<ReturnType<typeof createBrowserTelemetry>, 'context' | 'router'>;
  trustProxy?: string[];
  helmetMode?: 'managed' | 'inherited';
  errorMode?: 'managed' | 'inherited';
}) {
  const app = express();

  app.disable('x-powered-by');

  if (options.trustProxy) {
    app.set('trust proxy', options.trustProxy);
  }

  if (options.observability) {
    app.use(httpObservability(options.observability));
  }

  if ((options.helmetMode ?? 'managed') === 'managed') {
    app.use(securityHeaders());
  }

  app.use((request, response, next) => {
    if (decodeURIComponent(request.path).toLowerCase().endsWith('.map')) {
      response.status(404).json({ error: 'not_found' });

      return;
    }

    next();
  });
  if (options.browserTelemetry) {
    app.use(options.browserTelemetry.context);
    app.use('/telemetry', options.browserTelemetry.router);
  }

  if (options.auth) {
    app.use(options.auth.middleware);
  }

  app.use(
    '/api',
    options.api.createApp({
      basePath: '/api',
      authMode: 'inherited',
      errorMode: 'inherited',
      helmetMode: 'inherited',
      auth: options.auth,
      observability: options.observability,
    }),
  );
  // Public pages must never turn missing API or future application routes into site responses.
  app.use(['/api', '/app'], (_request, response) => response.status(404).json({ error: 'not_found' }));
  if (options.site) {
    app.use(serveStatic(options.site.clientDirectory, { index: false, redirect: false }));
    app.use(options.site.handler);
  }

  app.use((_request, response) => response.status(404).json({ error: 'not_found' }));
  if ((options.errorMode ?? 'managed') === 'managed') {
    app.use(httpErrorHandler);
  }

  return app;
}
