import { createHmac } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { env } from '../shared/env';

import { getRedis } from 'shared';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const attempts = new Map<string, { count: number; resetAt: number }>();
const otpDeliveryAttempts = new Map<string, { count: number; resetAt: number }>();
const otpVerificationAttempts = new Map<string, { count: number; resetAt: number }>();

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
  otpDeliveryAttempts.clear();
  otpVerificationAttempts.clear();
}

function consumeLimit(
  store: Map<string, { count: number; resetAt: number }>,
  key: string,
  windowMs: number,
  maximum: number,
) {
  const now = Date.now();
  const current = store.get(key);
  const state = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };

  state.count += 1;
  store.set(key, state);

  return { allowed: state.count <= maximum, retryAfter: Math.max(1, Math.ceil((state.resetAt - now) / 1000)) };
}

function rateLimitResponse(res: Response, retryAfter: number): void {
  res.setHeader('Retry-After', retryAfter);
  res.status(429).send({ code: 'rate_limited', message: 'Too many requests; retry after the cooldown.' });
}

async function consumePasswordRateLimit(req: Request): Promise<{ allowed: boolean; retryAfter: number }> {
  const identifier =
    typeof req.body?.email === 'string' ? req.body.email.normalize('NFKC').trim().toLowerCase() : 'invalid';
  const identifierKey = createHmac('sha256', env.SESSION_SECRET).update(identifier).digest('hex');

  if (env.DATABASE_DRIVER === 'memory') return { allowed: true, retryAfter: 1 };
  try {
    const redis = getRedis();
    const keys = [`auth:password:identifier:${identifierKey}`, `auth:password:ip:${req.ip}`];
    const limits = [env.AUTH_PASSWORD_RATE_IDENTIFIER_MAX, env.AUTH_PASSWORD_RATE_IP_MAX];
    const values = await Promise.all(keys.map((key) => redis.incr(key)));

    await Promise.all(keys.map((key) => redis.pexpire(key, env.AUTH_PASSWORD_RATE_WINDOW_MS)));
    const allowed = values.every((value, index) => value <= limits[index]!);

    return { allowed, retryAfter: Math.max(1, Math.ceil(env.AUTH_PASSWORD_RATE_WINDOW_MS / 1000)) };
  } catch {
    throw new Error('Authentication rate limiter unavailable.');
  }
}

function emailOtpDeliveryRateLimit(req: Request, res: Response, next: NextFunction): void {
  const email = typeof req.body?.email === 'string' ? req.body.email.normalize('NFKC').trim().toLowerCase() : undefined;
  const flowId = typeof req.body?.flowId === 'string' ? req.body.flowId : undefined;
  const destinationKey = email ?? flowId ?? 'invalid';
  const ipResult = consumeLimit(
    otpDeliveryAttempts,
    `ip:${req.ip}`,
    env.EMAIL_OTP_DELIVERY_WINDOW_MS,
    env.EMAIL_OTP_DELIVERY_IP_MAX,
  );
  const destinationResult = consumeLimit(
    otpDeliveryAttempts,
    `destination:${destinationKey}`,
    env.EMAIL_OTP_DELIVERY_WINDOW_MS,
    env.EMAIL_OTP_DELIVERY_EMAIL_MAX,
  );

  if (!ipResult.allowed || !destinationResult.allowed) {
    rateLimitResponse(res, Math.max(ipResult.retryAfter, destinationResult.retryAfter));

    return;
  }
  next();
}

function emailOtpVerificationRateLimit(req: Request, res: Response, next: NextFunction): void {
  const result = consumeLimit(
    otpVerificationAttempts,
    `ip:${req.ip}`,
    env.EMAIL_OTP_VERIFY_WINDOW_MS,
    env.EMAIL_OTP_VERIFY_IP_MAX,
  );

  if (!result.allowed) {
    rateLimitResponse(res, result.retryAfter);

    return;
  }
  next();
}

export {
  csrfProtection,
  emailOtpDeliveryRateLimit,
  emailOtpVerificationRateLimit,
  consumePasswordRateLimit,
  passkeyRateLimit,
  resetPasskeySecurityState,
};
