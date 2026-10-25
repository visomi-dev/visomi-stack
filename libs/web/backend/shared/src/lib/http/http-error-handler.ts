import type { ErrorRequestHandler } from 'express';

import { HttpError } from './http-error';

export const httpErrorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (response.headersSent) {
    response.destroy();

    return;
  }

  if (HttpError.is(error)) {
    // These fields are explicitly public. None are passed to operational telemetry.
    response.status(error.status).json({
      error: error.code,
      ...(error.publicMessage === undefined ? {} : { message: error.publicMessage }),
      ...(error.body === undefined ? {} : { body: error.body }),
    });

    return;
  }

  response.status(500).json({ error: 'internal_error' });
};
