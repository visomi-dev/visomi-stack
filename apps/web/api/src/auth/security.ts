import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Database } from '@visomi-stack/backend-shared';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from 'express';

import type { AuthConfig } from './config';

export class AuthError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}

export function csrf(config: AuthConfig): RequestHandler {
  return (request, _response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      next();

      return;
    }

    const supplied = request.get('x-csrf-token');
    const expected = request.session?.csrf;

    if (
      request.get('origin') !== config.origin ||
      !supplied ||
      !expected ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    ) {
      next(new AuthError('csrf_invalid', 403));

      return;
    }

    next();
  };
}

export function rateLimit(database: Database, config: AuthConfig): RequestHandler {
  return async (request, response, next) => {
    if (request.method === 'OPTIONS') {
      next();

      return;
    }

    // Only keyed digests are persisted; neither addresses nor digests are telemetry fields.
    const digest = createHmac('sha256', config.secret)
      .update(request.ip ?? 'unknown')
      .digest('hex');

    for (const [key, maximum] of [
      [digest, 60],
      ['global', 1000],
    ] as const) {
      const result = await database.execute<{ attempts: number }>(sql`
        INSERT INTO auth_rate_limits (key, attempts, expires_at)
        VALUES (${key}, 1, now() + interval '1 minute')
        ON CONFLICT (key) DO UPDATE SET
          attempts = CASE WHEN auth_rate_limits.expires_at <= now() THEN 1
            ELSE LEAST(auth_rate_limits.attempts + 1, 10001) END,
          expires_at = CASE WHEN auth_rate_limits.expires_at <= now() THEN now() + interval '1 minute'
            ELSE auth_rate_limits.expires_at END
        RETURNING attempts`);

      if (result.rows[0].attempts > maximum) {
        response.setHeader('Retry-After', '60');
        next(new AuthError('rate_limited', 429));

        return;
      }
    }
    next();
  };
}

export function requireFresh(user: Express.User | undefined, config: AuthConfig): Express.User {
  if (!user) {
    throw new AuthError('authentication_required', 401);
  }

  if (
    !Number.isFinite(user.authenticatedAt) ||
    Date.now() - user.authenticatedAt > config.freshMaxAge ||
    user.authenticatedAt > Date.now()
  ) {
    throw new AuthError('reauthentication_required', 401);
  }

  return user;
}
