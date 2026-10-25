import {
  currentObservability,
  httpObservability,
  operationalErrorHandler,
  type Observability,
} from '@visomi-stack/web-backend-shared';
import express from 'express';

export function createApp(options: { observability?: Observability } = {}) {
  const app = express();
  const observability = options.observability ?? currentObservability();

  app.disable('x-powered-by');

  if (observability) {
    app.use(httpObservability(observability));
  }

  app.get('/', (_request, response) => {
    response.json({ message: 'Hello API' });
  });
  app.use((_request, response) => {
    response.status(404).json({ error: 'not_found' });
  });
  app.use(operationalErrorHandler);

  return app;
}
