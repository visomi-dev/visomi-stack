import {
  currentObservability,
  HttpError,
  httpObservability,
  httpErrorHandler,
  securityHeaders,
  type Observability,
} from '@visomi-stack/web-backend-shared';
import express from 'express';

import { authRouter, authErrorHandler } from './auth/router';
import type { AuthRuntime } from './auth/runtime';

export { createAuthentication } from './auth/runtime';
export { authConfig } from './auth/config';

export type AppOptions = {
  observability?: Observability;
  auth?: AuthRuntime;
  authMode?: 'managed' | 'inherited';
  errorMode?: 'managed' | 'inherited';
  helmetMode?: 'managed' | 'inherited';
  trustProxy?: string[];
};

export function createApp(options: AppOptions = {}) {
  const app = express();
  const observability = options.observability ?? currentObservability();

  app.disable('x-powered-by');

  if (options.trustProxy) {
    app.set('trust proxy', options.trustProxy);
  }

  if (observability) {
    app.use(httpObservability(observability));
  }

  if ((options.helmetMode ?? 'managed') === 'managed') {
    app.use(securityHeaders());
  }

  if (options.auth) {
    if ((options.authMode ?? 'managed') === 'managed') {
      app.use(options.auth.middleware);
    }

    app.use('/auth', authRouter(options.auth), authErrorHandler);
  } else {
    app.use('/auth', (_request, _response, next) => next(new HttpError(503, 'authentication_unavailable')));
  }

  app.get('/', (_request, response) => {
    response.json({ message: 'Hello API' });
  });
  app.use((_request, response) => {
    response.status(404).json({ error: 'not_found' });
  });
  if ((options.errorMode ?? 'managed') === 'managed') {
    app.use(httpErrorHandler);
  }

  return app;
}
