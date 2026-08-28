import { join } from 'node:path';

import express, { type Express } from 'express';

import { healthRouter } from './routes/health';
import { indexRouter } from './routes/index';
import { manifestRouter } from './routes/manifest';
import { previewRouter } from './routes/preview';

const publicDir = join(process.cwd(), 'dist/apps/web/ui-designer/public');

export async function createServer(): Promise<Express> {
  const app = express();

  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.use('/public', express.static(publicDir, { fallthrough: false }));

  app.use('/', indexRouter());
  app.use('/', previewRouter());
  app.use('/api', manifestRouter());
  app.use('/', healthRouter());

  return app;
}
