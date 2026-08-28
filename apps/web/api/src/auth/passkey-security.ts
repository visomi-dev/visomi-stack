import type { NextFunction, Request, Response } from 'express';

import { env } from '../shared/env';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const attempts = new Map<string, { count: number; resetAt: number }>();
const passwordAttempts = new Map<string, { count: number; resetAt: number }>();

function expectedOrigin(): string {
  return process.env.WEBAUTHN_ORIGIN ?? new URL(env.APP_BASE_URL).origin;
}

function requestOrigin(req: Request): string | undefined {
  const origin = req.get('origin');

  if (origin) return origin;

  const referer = req.get('referer');

  return referer ? new URL(referer).origin : undefined;
}

function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();

    return;
  }

  if (requestOrigin(req) !== expectedOrigin()) {
    res.status(403).send({ code: 'csrf_origin_invalid', message: 'The request origin is not allowed.' });

    return;
  }

  next();
}

function passkeyRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : 'anonymous';
  const key = `${req.ip}:${email}`;
  const current = attempts.get(key);
  const state = current && current.resetAt > now ? current : { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  state.count += 1;
  attempts.set(key, state);

  if (state.count > RATE_LIMIT_MAX) {
    res.setHeader('Retry-After', Math.ceil((state.resetAt - now) / 1000));
    res.status(429).send({ code: 'rate_limited', message: 'Too many passkey attempts; retry after the cooldown.' });

    return;
  }

  next();
}

function resetPasskeySecurityState(): void {
  attempts.clear();
  passwordAttempts.clear();
}

function passwordRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = `${req.ip}:${req.user?.id ?? 'anonymous'}`;
  const current = passwordAttempts.get(key);
  const state = current && current.resetAt > now ? current : { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  state.count += 1;
  passwordAttempts.set(key, state);
  if (state.count > 5) {
    res.setHeader('Retry-After', Math.ceil((state.resetAt - now) / 1000));
    res
      .status(429)
      .send({ code: 'rate_limited', message: 'Too many password setup attempts; retry after the cooldown.' });

    return;
  }
  next();
}

export { csrfProtection, passkeyRateLimit, passwordRateLimit, resetPasskeySecurityState };
