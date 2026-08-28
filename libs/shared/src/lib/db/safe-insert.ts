import { HttpError } from '../http';

/**
 * Returns `true` when `error` is a Postgres unique-constraint violation on
 * the named index. Used to translate the DB-level error into an HTTP 409
 * when an application-level pre-check raced and let two requests through.
 *
 * Drizzle wraps the underlying driver error in `DrizzleQueryError`; the
 * Postgres SQLSTATE (`23505`) and the constraint name live on the wrapped
 * `cause`, so we walk the chain.
 */
function isUniqueViolation(error: unknown, indexName: string): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && !seen.has(current)) {
    seen.add(current);

    if (typeof current !== 'object') {
      return false;
    }

    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };

    if (candidate.code === '23505') {
      if (typeof candidate.constraint === 'string' && candidate.constraint === indexName) {
        return true;
      }
    }

    current = candidate.cause;
  }

  return false;
}

/**
 * Wraps a Drizzle insert (or any awaited DB operation) and translates a
 * Postgres unique-constraint violation on `indexName` into the supplied
 * `HttpError` shape. Any other error is re-thrown as-is so the global
 * error handler can surface it as 500.
 *
 * Usage:
 *
 *   const [user] = await safeInsert(
 *     db.insert(users).values({...}).returning(),
 *     'users_email_idx',
 *     { code: 'email_already_registered', message: 'An account already exists.', statusCode: 409 },
 *   );
 */
/**
 * Wraps a Drizzle insert (or any awaited DB operation) and translates a
 * Postgres unique-constraint violation on `indexName` into the supplied
 * `HttpError` shape. Any other error is re-thrown as-is so the global
 * error handler can surface it as 500.
 *
 * The operation is passed as a thunk so the caller can build the query
 * synchronously and the helper awaits it. Using a thunk also lets Drizzle's
 * builder types (which differ across driver backends — pglite returns
 * `Results<T>`, postgres-js returns `QueryResult<T>`) flow through without a
 * generic mismatch.
 *
 * Usage:
 *
 *   const [user] = await safeInsert(
 *     () => db.insert(users).values({...}).returning(),
 *     'users_email_idx',
 *     { code: 'email_already_registered', message: 'An account already exists.', statusCode: 409 },
 *   );
 */
export async function safeInsert(
  operation: () => unknown,
  indexName: string,
  httpError: Pick<HttpError, 'code' | 'message' | 'statusCode'>,
): Promise<unknown> {
  try {
    return await operation();
  } catch (error) {
    if (isUniqueViolation(error, indexName)) {
      throw new HttpError(httpError);
    }

    throw error;
  }
}
