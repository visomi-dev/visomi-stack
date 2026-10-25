import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AuthHttpError } from './auth-http-error';
import { HttpError } from './http-error';
import { httpErrorHandler } from './http-error-handler';

function handle(error: unknown, headersSent = false) {
  const response = { headersSent, status: vi.fn().mockReturnThis(), json: vi.fn(), destroy: vi.fn() };
  const next = vi.fn();

  httpErrorHandler(error, {} as Request, response as unknown as Response, next);

  return { response, next };
}

describe('HTTP error response boundary', () => {
  it('returns only explicitly public error fields, including a nullable body', () => {
    const error = new HttpError(422, 'request_invalid', 'Check the supplied fields.', null);
    const { response, next } = handle(error);

    expect(response.status).toHaveBeenCalledExactlyOnceWith(422);
    expect(response.json).toHaveBeenCalledExactlyOnceWith({
      error: 'request_invalid',
      message: 'Check the supplied fields.',
      body: null,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([401, 403] as const)('preserves code-only auth responses for status %s', (status) => {
    const { response } = handle(new AuthHttpError(status, 'access_denied'));

    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.json).toHaveBeenCalledExactlyOnceWith({ error: 'access_denied' });
  });

  it('permits deliberate public operational failures without exposing exception metadata', () => {
    const { response } = handle(new HttpError(503, 'temporarily_unavailable', 'Try again later.', { retryable: true }));

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledExactlyOnceWith({
      error: 'temporarily_unavailable',
      message: 'Try again later.',
      body: { retryable: true },
    });
  });

  it.each([
    new Error('SYNTHETIC_PRIVATE_SQL'),
    { status: 403, code: 'SYNTHETIC_PRIVATE_CODE', message: 'SYNTHETIC_PRIVATE_MESSAGE', body: 'private' },
  ])('sanitizes unrecognized exceptions instead of trusting their fields', (error) => {
    const { response } = handle(error);

    expect(response.status).toHaveBeenCalledExactlyOnceWith(500);
    expect(response.json).toHaveBeenCalledExactlyOnceWith({ error: 'internal_error' });
  });

  it('closes a started response without writing another body or forwarding the exception', () => {
    const { response, next } = handle(new HttpError(403, 'forbidden'), true);

    expect(response.destroy).toHaveBeenCalledExactlyOnceWith();
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
