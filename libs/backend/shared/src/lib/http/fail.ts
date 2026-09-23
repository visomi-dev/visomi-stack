import { HttpError } from '../http';

export function fail(code: string, message: string, statusCode = 409): never {
  throw new HttpError({ code, message, statusCode });
}
