import {
  currentObservability,
  HttpError,
  httpErrorHandler,
  httpObservability,
  routes,
  securityHeaders,
  type Observability,
} from '@visomi-stack/web-backend-shared';
import express from 'express';
import type { ProductPolicy } from '@visomi-stack/shared-persistence';

import { authErrorHandler, createAuthRouter } from './auth/router';
import type { AuthRuntime } from './auth/runtime';
import { createOpenApiDocument, documentationContract, homeContract } from './openapi';
import { createPersistenceRouter } from './persistence/router';

export { createAuthentication } from './auth/runtime';
export { anonymous } from './auth/shared/authorization';
export type { AuthorizationContext, AuthorizationPolicy, AuthorizationRequirement } from './auth/shared/authorization';
export { authConfig } from './auth/shared/config';
export const persistenceVersion = 1;

export type AppOptions = {
  observability?: Observability;
  auth?: AuthRuntime;
  authMode?: 'managed' | 'inherited';
  errorMode?: 'managed' | 'inherited';
  helmetMode?: 'managed' | 'inherited';
  trustProxy?: string[] | 1;
  basePath?: string;
  persistence?: ProductPolicy;
};

export function createApp(options: AppOptions = {}) {
  const app = express();
  const document = createOpenApiDocument(options.basePath, Boolean(options.persistence));
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

    app.use('/auth', createAuthRouter(options.auth), authErrorHandler);
  } else {
    app.use('/auth', (_request, _response, next) => next(new HttpError(503, 'authentication_unavailable')));
  }

  if (options.persistence) {
    app.use(
      '/persistence',
      options.auth
        ? createPersistenceRouter(options.auth, options.persistence)
        : (_request, _response, next) => next(new HttpError(503, 'authentication_unavailable')),
    );
  }

  routes.register(app, [
    { contract: documentationContract, handler: (_request, response) => response.json(document) },
    { contract: homeContract, handler: (_request, response) => response.json({ message: 'Hello API' }) },
  ]);
  app.use((_request, response) => {
    response.status(404).json({ error: 'not_found' });
  });

  if ((options.errorMode ?? 'managed') === 'managed') {
    app.use(httpErrorHandler);
  }

  return app;
}
