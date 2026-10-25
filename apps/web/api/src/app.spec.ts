import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { currentObservability, httpObservability } from '@visomi-stack/web-backend-shared';
import type { Observability } from '@visomi-stack/web-backend-shared';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app';

vi.mock('@visomi-stack/web-backend-shared', () => ({
  currentObservability: vi.fn(),
  httpObservability: vi.fn(() => (_request: unknown, _response: unknown, next: () => void) => next()),
  operationalErrorHandler: vi.fn(),
}));

function dispatch(app: ReturnType<typeof createApp>, url: string) {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);

  request.method = 'GET';
  request.url = url;

  return new Promise<{ status: number; body: unknown; poweredBy: unknown }>((resolve, reject) => {
    vi.spyOn(response, 'end').mockImplementation((chunk?: unknown) => {
      resolve({
        status: response.statusCode,
        body: JSON.parse(String(chunk)),
        poweredBy: response.getHeader('x-powered-by'),
      });

      return response;
    });
    app(request as Request, response as Response, reject);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentObservability).mockReturnValue(undefined);
});

describe('API composition', () => {
  it.each([
    ['/', 200, { message: 'Hello API' }],
    ['/missing', 404, { error: 'not_found' }],
  ])('responds to %s without initializing telemetry or opening a port', async (url, status, body) => {
    const result = await dispatch(createApp(), url as string);

    expect(result).toEqual({ status, body, poweredBy: undefined });
    expect(httpObservability).not.toHaveBeenCalled();
  });

  it('uses explicitly supplied observability ahead of the current process runtime', () => {
    const supplied = {} as Observability;
    const current = {} as Observability;

    vi.mocked(currentObservability).mockReturnValue(current);
    createApp({ observability: supplied });
    expect(httpObservability).toHaveBeenCalledExactlyOnceWith(supplied);
    expect(currentObservability).not.toHaveBeenCalled();
  });

  it('composes with an existing process runtime when none is supplied', () => {
    const current = {} as Observability;

    vi.mocked(currentObservability).mockReturnValue(current);
    createApp();
    expect(httpObservability).toHaveBeenCalledExactlyOnceWith(current);
  });
});
