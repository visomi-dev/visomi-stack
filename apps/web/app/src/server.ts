import { resolve } from 'node:path';

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express, { static as serveStatic } from 'express';

const app = express();
const engine = new AngularNodeAppEngine();
const browserDirectory = resolve(import.meta.dirname, '../browser');

app.disable('x-powered-by');
app.get(['/app', '/app/'], (_request, response) => response.redirect(302, '/app/en/'));
app.use('/app', serveStatic(browserDirectory, { index: false, redirect: false }));
app.use((request, response, next) => {
  engine
    .handle(request)
    .then((rendered) => (rendered ? writeResponseToNodeResponse(rendered, response) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url)) {
  const server = app.listen(Number(process.env['PORT'] ?? 4201), process.env['HOST'] ?? '127.0.0.1');

  process.once('SIGTERM', () => server.close());
  process.once('SIGINT', () => server.close());
}

export const reqHandler = createNodeRequestHandler(app);
