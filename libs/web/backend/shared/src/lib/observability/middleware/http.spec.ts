import { EventEmitter } from 'node:events';

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { Observability } from '../lib/observability';

import { httpObservability, operationalErrorHandler } from './http';

function fixture(statusCode = 200, writableFinished = true) {
  const finish = vi.fn();
  const run = vi.fn(<T>(work: () => T) => work());
  const beginHttp = vi.fn(() => ({ run, finish }));
  const correlation = vi.fn(() => ({ requestId: 'synthetic-random-operation', traceId: 'trace', spanId: 'span' }));
  const observability = { beginHttp, correlation } as unknown as Observability;
  const response = Object.assign(new EventEmitter(), {
    statusCode,
    writableFinished,
    headersSent: false,
    setHeader: vi.fn(),
    destroy: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  });
  const next = vi.fn();
  const invoke = () => httpObservability(observability)({} as Request, response as unknown as Response, next);

  return { response, next, beginHttp, correlation, run, finish, invoke };
}

describe('HTTP observability adapter', () => {
  it.each([
    [200, true, 'success'],
    [404, true, 'client_error'],
    [500, true, 'server_error'],
    [200, false, 'aborted'],
  ] as const)('completes status %s, finished %s once as %s', (status, finished, outcome) => {
    const f = fixture(status, finished);

    f.invoke();
    expect(f.next).toHaveBeenCalledOnce();
    expect(f.response.setHeader).toHaveBeenCalledWith('x-request-id', 'synthetic-random-operation');
    f.response.emit(finished ? 'finish' : 'close');
    f.response.emit('close');
    f.response.emit('finish');
    expect(f.finish).toHaveBeenCalledExactlyOnceWith(outcome, status);
    expect(f.response.listenerCount('finish')).toBe(0);
    expect(f.response.listenerCount('close')).toBe(0);
  });

  it('reuses the response operation and re-enters its context in a second adapter', () => {
    const f = fixture();

    f.invoke();
    f.invoke();
    f.response.emit('finish');
    expect(f.beginHttp).toHaveBeenCalledOnce();
    expect(f.run).toHaveBeenCalledTimes(2);
    expect(f.next).toHaveBeenCalledTimes(2);
    expect(f.finish).toHaveBeenCalledOnce();
    expect(f.response.setHeader).toHaveBeenCalledOnce();
  });

  it('continues without adding a header when correlation is unavailable', () => {
    const f = fixture();

    f.correlation.mockReturnValue(undefined as never);
    f.invoke();
    expect(f.response.setHeader).not.toHaveBeenCalled();
    expect(f.next).toHaveBeenCalledOnce();
  });

  it('returns a controlled error response without reflecting the exception', () => {
    const f = fixture();

    operationalErrorHandler(
      new Error('SYNTHETIC_PRIVATE_MARKER'),
      {} as Request,
      f.response as unknown as Response,
      f.next,
    );
    expect(f.response.status).toHaveBeenCalledWith(500);
    expect(f.response.json).toHaveBeenCalledExactlyOnceWith({ error: 'internal_error' });
    expect(f.response.destroy).not.toHaveBeenCalled();
    expect(f.next).not.toHaveBeenCalled();
  });

  it('destroys a started response without passing the raw exception to the socket', () => {
    const f = fixture();

    f.response.headersSent = true;
    operationalErrorHandler(
      new Error('SYNTHETIC_PRIVATE_MARKER'),
      {} as Request,
      f.response as unknown as Response,
      f.next,
    );
    expect(f.response.destroy).toHaveBeenCalledExactlyOnceWith();
    expect(f.response.status).not.toHaveBeenCalled();
    expect(f.response.json).not.toHaveBeenCalled();
  });
});
