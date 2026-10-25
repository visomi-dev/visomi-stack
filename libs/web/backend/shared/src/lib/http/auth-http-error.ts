import { HttpError } from './http-error';
import type { HttpErrorBody } from './http-error';

export class AuthHttpError extends HttpError {
  constructor(status: 401 | 403, code: string, message?: string, body?: HttpErrorBody) {
    if (status !== 401 && status !== 403) {
      throw new RangeError('auth_http_error_status_invalid');
    }

    super(status, code, message, body);
    this.name = 'AuthHttpError';
  }
}
