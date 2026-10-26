import { describe, expect, it } from 'vitest';

import { AuthHttpError } from './auth-http-error';
import { HttpError } from './http-error';

describe('authentication and authorization HTTP errors', () => {
  it.each([401, 403] as const)('specializes HttpError for status %s', (status) => {
    const error = new AuthHttpError(status, 'access_denied', 'Access is denied.', { retryable: false });

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status, code: 'access_denied', message: 'Access is denied.' });
    expect(error.body).toEqual({ retryable: false });
    expect(HttpError.is(error)).toBe(true);
  });

  it.each([400, 404, 429, 503])('rejects non-authentication status %s even from untyped callers', (status) => {
    expect(() => new AuthHttpError(status as 401, 'invalid')).toThrow('auth_http_error_status_invalid');
  });
});
