import { resolve } from 'node:path';

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express, { static as serveStatic } from 'express';

import {
  browserAssets,
  createBrowserTelemetry,
  httpErrorHandler,
  httpObservability,
  initializeObservability,
} from '@visomi-stack/web-backend-shared';

const app = express();
const engine = new AngularNodeAppEngine();
const browserDirectory = resolve(import.meta.dirname, '../browser');
const telemetry =
  isMainModule(import.meta.url) && process.env['VISOMI_BROWSER_TELEMETRY'] === 'true'
    ? initializeObservability({
        service: 'web-app',
        version: process.env['APP_VERSION'] ?? 'unknown',
        environment: process.env['NODE_ENV'],
      })
    : undefined;

app.disable('x-powered-by');
if (telemetry) {
  const assets = await browserAssets(browserDirectory, '/app');

  app.use(httpObservability(telemetry));
  const browserTelemetry = createBrowserTelemetry({
    observability: telemetry,
    assets,
    application: 'web-app',
    origin: process.env['BROWSER_TELEMETRY_ORIGIN'] ?? `http://127.0.0.1:${process.env['PORT'] ?? 4201}`,
  });

  app.use(browserTelemetry.context);
  app.use('/telemetry', browserTelemetry.router);
}

app.use((request, response, next) => {
  if (decodeURIComponent(request.path).toLowerCase().endsWith('.map')) {
    response.sendStatus(404);

    return;
  }

  next();
});
app.get(['/app', '/app/'], (_request, response) => response.redirect(302, '/app/en/'));
app.use('/app', serveStatic(browserDirectory, { index: false, redirect: false }));
app.use((request, response, next) => {
  engine
    .handle(request)
    .then((rendered) => (rendered ? writeResponseToNodeResponse(rendered, response) : next()))
    .catch(next);
});
app.use(httpErrorHandler);

if (isMainModule(import.meta.url)) {
  const server = app.listen(Number(process.env['PORT'] ?? 4201), process.env['HOST'] ?? '127.0.0.1');

  let stopping = false;
  const stop = () => {
    if (stopping) {
      return;
    }

    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 5000);

    server.close(() => {
      void (telemetry?.shutdown() ?? Promise.resolve(true)).then((flushed) => {
        clearTimeout(deadline);
        process.exitCode = flushed ? 0 : 1;
      });
    });
  };

  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

export const reqHandler = createNodeRequestHandler(app);
