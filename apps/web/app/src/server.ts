import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express, { static as serveStatic, type Request } from 'express';

import type { AuthUser } from './app/shared/auth/auth.models';

type AuthenticatedRequest = Request & {
  user?: AuthUser | null;
};

const serverDistFolder = dirname(fileURLToPath(import.meta.url));

const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();

const angularApp = new AngularNodeAppEngine();

app.use(
  serveStatic(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

app.use((req, res, next) => {
  const request = req as AuthenticatedRequest;
  const user = request.user ?? null;

  angularApp
    .handle(req, { user })
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;

  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);
