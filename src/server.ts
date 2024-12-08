import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AngularAppEngine, createRequestHandler } from '@angular/ssr';
import { isMainModule } from '@angular/ssr/node';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import { api } from './api/api.config';

const app = new Hono();

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const angularApp = new AngularAppEngine();

app.use(logger());

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/**', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */
app.route('/api', api);

/**
 * Serve static files from /browser
 */
app.use(serveStatic({ root: browserDistFolder }));

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use('/*', async (ctx, next) => {
  const response = await angularApp.handle(ctx.req.raw);

  if (!response) {
    return next();
  }

  return response;
});

/**
 * The request handler used by the Angular CLI (dev-server and during build).
 */
export const reqHandler = createRequestHandler(app.fetch);

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 4200;

  serve(
    {
      fetch: app.fetch,
      port,
    },
    () => {
      console.log(`Server is running on http://localhost:${port}`);
    },
  );
}
