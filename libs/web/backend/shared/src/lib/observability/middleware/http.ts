import type { RequestHandler, Response } from 'express';

import type { Observability } from '../lib/observability';

export { httpErrorHandler as operationalErrorHandler } from '../../http/http-error-handler';

const ownershipKey = Symbol.for('visomi-stack.http-observability.v1');

type Ownership = ReturnType<Observability['beginHttp']>;
type InstrumentedResponse = Response & { [ownershipKey]?: Ownership };

export function httpObservability(observability: Observability): RequestHandler {
  return (_request, response: InstrumentedResponse, next) => {
    const existing = response[ownershipKey];

    if (existing) {
      existing.run(next);

      return;
    }

    const request = observability.beginHttp();

    response[ownershipKey] = request;
    request.run(() => {
      const ids = observability.correlation();

      if (ids) {
        response.setHeader('x-request-id', ids.requestId);
      }

      const complete = () => {
        response.off('finish', complete);
        response.off('close', complete);
        const status = response.statusCode;
        const outcome = !response.writableFinished
          ? 'aborted'
          : status >= 500
            ? 'server_error'
            : status >= 400
              ? 'client_error'
              : 'success';

        request.finish(outcome, status);
      };

      response.once('finish', complete);
      response.once('close', complete);
      next();
    });
  };
}
