import express, { json, type Express } from 'express';
import morgan from 'morgan';

import { activationRouter } from './activation/activation-router';
import { authRouter } from './auth/auth-router';
import { passkeyRouter } from './auth/passkey-router';
import { capabilityRouter } from './capabilities/capability-router';
import './auth/passport';
import { projectsRouter } from './projects/projects-router';
import { opaqueSyncRouter } from './sync/opaque-sync-router';
import { webAuthnRouter } from './webauthn/webauthn-router';
import { env } from './shared/env';
import { createOpenApiDocument } from './shared/http/openapi';
import { testRouter } from './testing/test-router';

import { createAuthRuntimeMiddleware, errorHandler, runMigrationsIfEnabled } from 'shared';

let embeddedAppPromise: Promise<Express> | undefined;

let standaloneAppPromise: Promise<Express> | undefined;

type CreateAppOptions = {
  mountAuthRuntime?: boolean;
};

const morganFormat = process.env['MORGAN_FORMAT'] ?? 'dev';

async function buildApp({ mountAuthRuntime = true }: CreateAppOptions = {}) {
  await runMigrationsIfEnabled();

  const app = express();

  app.use(json());
  app.use(morgan(morganFormat));

  if (mountAuthRuntime) {
    app.use(...createAuthRuntimeMiddleware());
  }

  app.use((req, res, next) => {
    const supportedMethods = new Set(['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

    if (!supportedMethods.has(req.method)) {
      res.setHeader('Allow', 'GET, POST, PATCH, DELETE, OPTIONS, HEAD');
      res.status(405).send({ code: 'method_not_allowed', message: 'The requested method is not allowed.' });

      return;
    }

    next();
  });

  app.get('/', (_req, res) => {
    res.send({ message: 'Hello Visomi Stack API' });
  });

  app.get('/health', (_req, res) => {
    res.send({ status: 'ok' });
  });

  app.get('/openapi.json', (_req, res) => {
    res.send(createOpenApiDocument());
  });

  const documentedRoutes = Object.entries(createOpenApiDocument().paths ?? {}).map(([template, pathItem]) => ({
    methods: new Set(
      Object.keys(pathItem)
        .filter((key) => ['get', 'post', 'patch', 'delete', 'put', 'options', 'head'].includes(key))
        .map((key) => key.toUpperCase()),
    ),
    template: template.split('/').filter(Boolean),
  }));

  app.use((req, res, next) => {
    const requestPath = req.path.split('/').filter(Boolean);
    const route = documentedRoutes.find(
      ({ template }) =>
        template.length === requestPath.length &&
        template.every((segment, index) => segment.startsWith('{') || segment === requestPath[index]),
    );

    if (route && !route.methods.has(req.method)) {
      res.setHeader('Allow', [...route.methods].join(', '));
      res.status(405).send({ code: 'method_not_allowed', message: 'The requested method is not allowed.' });

      return;
    }

    next();
  });

  app.use('/auth', authRouter);
  app.use('/auth/passkey', passkeyRouter);
  app.use('/activation', activationRouter);
  app.use('/projects', projectsRouter);
  app.use('/sync', opaqueSyncRouter);
  app.use('/capabilities', capabilityRouter);
  app.use('/webauthn', webAuthnRouter);

  if (env.ENABLE_TEST_API) {
    app.use('/test', testRouter);
  }

  app.use(errorHandler);

  return app;
}

function createApp(options?: CreateAppOptions) {
  if (options?.mountAuthRuntime === false) {
    embeddedAppPromise ??= buildApp(options);

    return embeddedAppPromise;
  }

  standaloneAppPromise ??= buildApp(options);

  return standaloneAppPromise;
}

export { createApp };
