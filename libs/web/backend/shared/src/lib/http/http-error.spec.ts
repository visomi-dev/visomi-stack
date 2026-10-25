import { describe, expect, it, vi } from 'vitest';

import { HttpError } from './http-error';

describe('public HTTP errors', () => {
  it('retains the explicit status, code, public message and JSON body', () => {
    const body = { fields: ['displayName'], retryable: false };
    const error = new HttpError(422, 'request_invalid', 'Check the supplied fields.', body);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ status: 422, code: 'request_invalid', message: 'Check the supplied fields.', body });
    expect(HttpError.is(error)).toBe(true);
  });

  it('uses the code for exception diagnostics without implicitly adding a public message', () => {
    const error = new HttpError(409, 'conflict');

    expect(error.message).toBe('conflict');
    expect(error.publicMessage).toBeUndefined();
    expect(error.body).toBeUndefined();
  });

  it.each([200, 399, 600, 401.5, NaN])('rejects invalid error status %s', (status) => {
    expect(() => new HttpError(status, 'invalid')).toThrow('http_error_status_invalid');
  });

  it.each([null, new Error('private'), { status: 403, code: 'forbidden', message: 'private' }])(
    'does not trust arbitrary thrown objects or status-like properties',
    (error) => {
      expect(HttpError.is(error)).toBe(false);
    },
  );

  it('recognizes an independent module copy without relying on instanceof', async () => {
    vi.resetModules();
    const other = await import('./http-error');
    const error = new other.HttpError(409, 'conflict', 'Try again.', { retryable: true });

    expect(error).not.toBeInstanceOf(HttpError);
    expect(HttpError.is(error)).toBe(true);
  });
});
