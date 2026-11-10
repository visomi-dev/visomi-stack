import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { HttpError, httpErrorHandler } from '@visomi-stack/web-backend-shared';
import type { ErrorRequestHandler } from 'express';

async function loadDocuments(clientDirectory?: string) {
  const documents = new Map<string, Buffer>();

  if (!clientDirectory) {
    return documents;
  }

  await Promise.all(
    ['en', 'es'].map(async (locale) => {
      const directory = join(clientDirectory, locale, 'system-errors');
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && /^(?:[45]\d\d|[45]xx)$/.test(entry.name))
          .map(async (entry) => {
            try {
              const body = await readFile(join(directory, entry.name, 'index.html'));

              documents.set(`${locale}/${entry.name}`, body);
            } catch {
              // Missing compiled documents retain the public JSON fallback.
            }
          }),
      );
    }),
  );

  return documents;
}

export function pageErrors(clientDirectory?: string): ErrorRequestHandler {
  // Compiled documents are immutable for an app instance; requests only read the bounded cache.
  const documents = loadDocuments(clientDirectory);

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

    try {
      const pages = await documents;
      const body = pages.get(`${locale}/${status}`) ?? pages.get(`${locale}/${status < 500 ? '4xx' : '5xx'}`);

      if (!body) {
        httpErrorHandler(error, request, response, next);

        return;
      }

      response.status(status).set('content-language', locale).type('html').send(body);
    } catch {
      httpErrorHandler(error, request, response, next);
    }
  };
}
