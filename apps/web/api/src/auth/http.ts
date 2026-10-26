import { randomBytes } from 'node:crypto';

import { HttpError } from '@visomi-stack/web-backend-shared';
import type { Request } from 'express';

import type { Factor } from './factors';
import type { Principal } from './identity';
import type { AuthRuntime } from './runtime';

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
