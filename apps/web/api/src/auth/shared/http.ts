import { randomBytes } from 'node:crypto';

import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';
import type { NextFunction, Request, Response } from 'express';

import type { AuthRuntime } from '../runtime';
import type { Factor } from '../totp/service';

import { validPrincipal, type Principal } from './identity';

export function body(request: Request, keys: string[]) {
  const value: unknown = request.body;

  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new HttpError(400, 'request_invalid');
  }

  return value as Record<string, unknown>;
}
export function text(value: unknown, maximum = 512) {
  if (typeof value !== 'string' || !value || value.length > maximum) {
    throw new HttpError(400, 'request_invalid');
  }

  return value;
}
export function identifier(value: unknown) {
  const result = text(value);

  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(result)) {
    throw new HttpError(400, 'request_invalid');
  }

  return result;
}
export function factor(value: unknown): Factor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'request_invalid');
  }

  const input = value as Record<string, unknown>;

  if (
    Object.keys(input).some((key) => !['kind', 'code'].includes(key)) ||
    !['email', 'totp', 'recovery_code'].includes(String(input.kind))
  ) {
    throw new HttpError(400, 'request_invalid');
  }

  return { kind: input.kind as Factor['kind'], code: text(input.code, 128) };
}
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
export async function establishSession(request: Request, user: Express.User, auth?: AuthRuntime) {
  const previous = request.sessionID;

  await new Promise<void>((resolve, reject) =>
    request.logIn(user, (error) => (error ? reject(new HttpError(503, 'session_unavailable')) : resolve())),
  );
  request.session.csrf = randomBytes(32).toString('base64url');
  await saveSession(request);
  if (auth && user.grantId) {
    await auth.recovery.bindGrant(previous, request.sessionID, user as Principal);
  }
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

export async function sendAuthenticationResult(
  auth: AuthRuntime,
  request: Request,
  response: Response,
  user: Express.User | null,
  extras: Record<string, unknown> = {},
) {
  if (user) {
    await establishSession(request, user, auth);
    response.json({ ...sessionView(request), ...extras });
  } else {
    await destroySession(request);
    response.clearCookie(auth.config.cookieName, {
      httpOnly: true,
      secure: auth.config.secure,
      sameSite: 'strict',
      path: '/',
    });
    response.status(204).end();
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
