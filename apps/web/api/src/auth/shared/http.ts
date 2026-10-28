import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';
import type { NextFunction, Request, Response } from 'express';

import { validPrincipal, type Principal } from './identity';

export function saveSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    request.session.save((error) => (error ? reject(new HttpError(503, 'session_unavailable')) : resolve())),
  );
}
export function sessionView(request: Request) {
  const user = request.user;

  return {
    authenticated: request.isAuthenticated(),
    user: user ? { id: user.id, email: user.email ?? null, emailVerified: user.emailVerified ?? false } : null,
    csrfToken: request.session.csrf,
    access: user?.level ?? 'anonymous',
    method: user?.method ?? null,
    nextStep: !user
      ? null
      : user.level === 'full'
        ? null
        : user.level === 'unverified'
          ? user.email
            ? 'verify_email'
            : 'add_email'
          : 'enroll_method',
  };
}

export function destroySession(request: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    request.session.destroy((error) => (error ? reject(new HttpError(503, 'session_unavailable')) : resolve())),
  );
}

export function requirePrincipal(request: Request): Principal {
  if (!validPrincipal(request.user)) {
    throw new AuthHttpError(401, 'authentication_required');
  }

  return request.user;
}

export function requireAnonymousSession(request: Request): void {
  if (request.user) {
    throw new AuthHttpError(403, 'anonymous_session_required');
  }
}

export function authErrorHandler(
  error: Error & { type?: string },
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(error);

    return;
  }

  if (HttpError.is(error)) {
    next(error);

    return;
  }

  if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
    next(new HttpError(error.type === 'entity.too.large' ? 413 : 400, 'request_invalid'));

    return;
  }

  // Includes SQL/driver failures; neither the query nor its parameters leave the boundary.
  next(new HttpError(503, 'authentication_unavailable'));
}
