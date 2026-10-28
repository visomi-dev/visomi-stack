import {
  httpErrorHandler,
  httpObservability,
  securityHeaders,
  type Observability,
} from '@visomi-stack/web-backend-shared';
import express from 'express';

import type { ApiModule, EmbeddedAuthentication } from './api-module';

export function createGatewayApp(options: {
  api: ApiModule;
  auth?: EmbeddedAuthentication;
  observability?: Observability;
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
  app.use((_request, response) => response.status(404).json({ error: 'not_found' }));
  if ((options.errorMode ?? 'managed') === 'managed') {
    app.use(httpErrorHandler);
  }

  return app;
}
