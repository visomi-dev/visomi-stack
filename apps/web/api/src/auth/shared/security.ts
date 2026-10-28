import { createHmac, timingSafeEqual } from 'node:crypto';

import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Router } from 'express';
import { rateLimit as expressRateLimit } from 'express-rate-limit';

import type { AuthConfig } from './config';
import type { RequestLimitStore } from './request-limit-store';

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
      next(new AuthHttpError(403, 'csrf_invalid'));

      return;
    }

    next();
  };
}

export function rateLimit(store: RequestLimitStore, config: AuthConfig): Router {
  const router = Router();
  const options = {
    windowMs: 60_000,
    store,
    legacyHeaders: false,
    standardHeaders: false,
    passOnStoreError: false,
    skip: (request: Request) => request.method === 'OPTIONS',
    handler: rejectLimitedRequest,
    // Both limiters share a stateless adapter, with distinct address/global keys.
    // Address keys deliberately retain the existing exact-address HMAC policy.
    validate: { unsharedStore: false, keyGeneratorIpFallback: false },
    // Third-party diagnostics can contain request/database values. HTTP errors
    // already reach the owner's controlled error boundary; never log these objects.
    logger: { error: discardLimitDiagnostic, warn: discardLimitDiagnostic },
  } as const;

  router.use(
    expressRateLimit({
      ...options,
      limit: 60,
      keyGenerator: (request: Request) =>
        createHmac('sha256', config.secret)
          .update(request.ip ?? 'unknown')
          .digest('hex'),
    }),
  );
  router.use(expressRateLimit({ ...options, limit: 1000, keyGenerator: () => 'global' }));

  return router;
}

function rejectLimitedRequest(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Retry-After', '60');
  next(new HttpError(429, 'rate_limited'));
}

function discardLimitDiagnostic(): void {
  // Raw library diagnostics are outside the operational telemetry allowlist.
}

export function requireFresh(user: Express.User | undefined, config: AuthConfig): Express.User {
  if (!user) {
    throw new AuthHttpError(401, 'authentication_required');
  }

  if (
    !Number.isFinite(user.authenticatedAt) ||
    Date.now() - user.authenticatedAt > config.freshMaxAge ||
    user.authenticatedAt > Date.now()
  ) {
    throw new AuthHttpError(401, 'reauthentication_required');
  }

  return user;
}
