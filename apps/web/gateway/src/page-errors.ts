import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { HttpError, httpErrorHandler } from '@visomi-stack/web-backend-shared';
import type { ErrorRequestHandler } from 'express';

export function pageErrors(clientDirectory?: string): ErrorRequestHandler {
  return async (error, request, response, next) => {
    if (!clientDirectory || response.headersSent || /^\/(?:api|telemetry)(?:\/|$)/i.test(request.path)) {
      httpErrorHandler(error, request, response, next);

      return;
    }

    response.set('cache-control', 'no-store').vary('Accept');

    if (request.accepts(['json', 'html']) !== 'html') {
      httpErrorHandler(error, request, response, next);

      return;
    }

    const status = HttpError.is(error) ? error.status : 500;
    const locale = /^\/(?:app\/)?es(?:\/|$)/.test(request.path) ? 'es' : 'en';
    const directory = join(clientDirectory, locale, 'system-errors');

    try {
      const body = await readFile(join(directory, String(status), 'index.html')).catch(() =>
        readFile(join(directory, status < 500 ? '4xx' : '5xx', 'index.html')),
      );

      response.status(status).set('content-language', locale).type('html').send(body);
    } catch {
      httpErrorHandler(error, request, response, next);
    }
  };
}
