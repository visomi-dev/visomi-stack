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
import type { BackupObjects } from '@visomi-stack/backend-db';

import { authErrorHandler, createAuthRouter } from './auth/router';
import type { AuthRuntime } from './auth/runtime';
import { createOpenApiDocument, documentationContract, homeContract } from './openapi';
import { createExampleRouter, examplePath } from './example/router';

export { createAuthentication } from './auth/runtime';
export { anonymous } from './auth/shared/authorization';
export type { AuthorizationContext, AuthorizationPolicy, AuthorizationRequirement } from './auth/shared/authorization';
export { authConfig } from './auth/shared/config';
export { createBackupObjects } from './db/s3-backup';
export const exampleApiVersion = 1;

export type AppOptions = {
  observability?: Observability;
  auth?: AuthRuntime;
  authMode?: 'managed' | 'inherited';
  errorMode?: 'managed' | 'inherited';
  helmetMode?: 'managed' | 'inherited';
  trustProxy?: string[] | 1;
  basePath?: string;
  exampleHarness?: boolean;
  backupObjects?: BackupObjects;
};

export function createApp(options: AppOptions = {}) {
  const app = express();
  const examples = options.auth
    ? createExampleRouter(options.auth, options.exampleHarness, options.backupObjects)
    : undefined;
  const document = createOpenApiDocument(options.basePath, examples?.contracts);
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

  if (examples) {
    app.use(examplePath, examples.router);
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
