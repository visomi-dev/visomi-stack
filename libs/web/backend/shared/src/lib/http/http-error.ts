const httpErrorKey = Symbol.for('visomi-stack.http-error.v1');

export type HttpErrorBody = null | string | number | boolean | HttpErrorBody[] | { [key: string]: HttpErrorBody };

export class HttpError extends Error {
  readonly [httpErrorKey] = true;
  readonly publicMessage?: string;

  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly body?: HttpErrorBody,
  ) {
    super(message ?? code);

    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new RangeError('http_error_status_invalid');
    }

    this.name = 'HttpError';
    this.publicMessage = message;
  }

  static is(error: unknown): error is HttpError {
    // API and host may bundle independent copies of this class in the same process.
    return (
      typeof error === 'object' &&
      error !== null &&
      httpErrorKey in error &&
      error[httpErrorKey] === true &&
      'status' in error &&
      typeof error.status === 'number' &&
      Number.isInteger(error.status) &&
      error.status >= 400 &&
      error.status <= 599 &&
      'code' in error &&
      typeof error.code === 'string' &&
      'message' in error &&
      typeof error.message === 'string' &&
      (!('publicMessage' in error) || error.publicMessage === undefined || typeof error.publicMessage === 'string')
    );
  }
}
