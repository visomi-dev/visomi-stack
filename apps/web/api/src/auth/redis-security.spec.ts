import { createHmac, randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';

import { env } from '../shared/env';

import {
  authenticationRateLimit,
  consumeAuthenticationVerificationLimit,
  consumeEmailOtpDeliveryLimit,
  consumeFactorVerificationLimit,
  emailOtpDeliveryRateLimit,
  resetPasskeySecurityState,
} from './passkey-security';

import { getRedis } from 'shared';

// Opt in with DATABASE_DRIVER=pg and REDIS_URL pointing at a disposable Redis.
// The final test shuts that server down; the launcher must own its lifecycle.
const suite = process.env.AUTH_REDIS_INTEGRATION === '1' ? describe : describe.skip;

suite('production authentication limiters with real Redis', () => {
  const prefix = randomUUID();
  const keys = new Set<string>();

  function ip(label: string): string {
    const value = `${prefix}-${label}`;

    keys.add(`auth:delivery:ip:${value}`);
    keys.add(`auth:verification:ip:${value}`);
    keys.add(`auth:factor:ip:${value}`);

    return value;
  }

  function destination(label: string): string {
    const value = `${prefix}-${label}@example.test`;
    const hash = createHmac('sha256', env.SESSION_SECRET).update(value).digest('hex');

    keys.add(`auth:delivery:destination:${hash}`);
    keys.add(`auth:delivery:cooldown:${hash}`);

    return value;
  }

  function request(address: string, body = {}): Request {
    return { ip: address, body } as Request;
  }

  function response() {
    const res = { setHeader: jest.fn(), status: jest.fn(), send: jest.fn() };

    res.status.mockReturnValue(res);

    return res;
  }

  beforeAll(async () => {
    expect(env.DATABASE_DRIVER).toBe('pg');
    expect(process.env.AUTH_REDIS_OWNED_PID).toMatch(/^\d+$/);
    const url = new URL(env.REDIS_URL);

    expect(url.hostname).toBe('127.0.0.1');
    expect(Number(url.port)).toBeGreaterThan(0);
    expect(await getRedis().ping()).toBe('PONG');
    expect(await getRedis().info('server')).toContain(`process_id:${process.env.AUTH_REDIS_OWNED_PID}\r\n`);
    console.info(
      `Real Redis limits: driver=${env.DATABASE_DRIVER}, IP=${env.EMAIL_OTP_DELIVERY_IP_MAX}, destination=${env.EMAIL_OTP_DELIVERY_EMAIL_MAX}, cooldown=${env.PIN_RESEND_COOLDOWN_SECONDS}s.`,
    );
  });

  afterAll(async () => {
    const redis = getRedis();

    if (redis.status === 'ready') {
      if (keys.size) await redis.del(...keys);
      await redis.quit();
    } else if (redis.status !== 'end') {
      redis.disconnect();
    }
  });

  it('shares normalized destination cooldown across fresh flow IDs, IPs, and cleared local state', async () => {
    const email = destination('cooldown');
    const first = jest.fn();
    const second = jest.fn();
    const res = response();

    await emailOtpDeliveryRateLimit(
      request(ip('first-flow'), { email: `  ${email.toUpperCase()}  `, flowId: randomUUID() }),
      res as unknown as Response,
      first,
    );
    expect(first).toHaveBeenCalledTimes(1);
    resetPasskeySecurityState();
    await emailOtpDeliveryRateLimit(
      request(ip('fresh-flow'), { email, flowId: randomUUID() }),
      res as unknown as Response,
      second,
    );
    expect(second).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    const retry = res.setHeader.mock.calls[0][1] as number;

    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(env.PIN_RESEND_COOLDOWN_SECONDS);
    // NFKC-equivalent destination must share the same Redis key too.
    expect((await consumeEmailOtpDeliveryLimit(ip('unicode'), email.replace('@', '＠'), true)).allowed).toBe(false);
  });

  it('allows only one concurrent delivery for the same destination cooldown', async () => {
    const email = destination('race-cooldown');
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, index) => consumeEmailOtpDeliveryLimit(ip(`race-${index}`), email, true)),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => !result.allowed).every((result) => result.retryAfter > 0)).toBe(true);
  });

  it('atomically enforces the IP quota across concurrent distinct destinations', async () => {
    const address = ip('ip-quota');
    const results = await Promise.all(
      Array.from({ length: env.EMAIL_OTP_DELIVERY_IP_MAX + 8 }, (_, index) =>
        consumeEmailOtpDeliveryLimit(address, destination(`ip-quota-${index}`), true),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(env.EMAIL_OTP_DELIVERY_IP_MAX);
    expect(Number(await getRedis().get(`auth:delivery:ip:${address}`))).toBe(env.EMAIL_OTP_DELIVERY_IP_MAX + 8);
    expect(await getRedis().pttl(`auth:delivery:ip:${address}`)).toBeGreaterThan(0);
  });

  it('atomically shares destination quota across IPs and delivery callers', async () => {
    const email = destination('destination-quota');
    const results = await Promise.all(
      Array.from({ length: env.EMAIL_OTP_DELIVERY_EMAIL_MAX + 8 }, (_, index) =>
        consumeEmailOtpDeliveryLimit(ip(`destination-${index}`), email),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(env.EMAIL_OTP_DELIVERY_EMAIL_MAX);
    expect((await consumeEmailOtpDeliveryLimit(ip('destination-fresh-flow'), email, true)).allowed).toBe(false);
  });

  it('atomically limits verification to 30 per IP across fresh flows', async () => {
    const address = ip('verification');
    const results = await Promise.all(
      Array.from({ length: 40 }, () =>
        consumeAuthenticationVerificationLimit(request(address, { flowId: randomUUID() })),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(30);
    expect(results.every((result) => result.retryAfter > 0 && result.retryAfter <= 60)).toBe(true);
    expect(await getRedis().get(`auth:verification:ip:${address}`)).toBe('40');
    const next = jest.fn();
    const res = response();

    await authenticationRateLimit(request(address), res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect((await consumeAuthenticationVerificationLimit(request(ip('other-verification')))).allowed).toBe(true);
  });

  it('atomically enforces both factor user and IP budgets', async () => {
    const user = `${prefix}-factor-user`;

    keys.add(`auth:factor:user:${user}`);
    const perUser = await Promise.all(
      Array.from({ length: 40 }, (_, index) => consumeFactorVerificationLimit(user, ip(`factor-user-${index}`))),
    );

    expect(perUser.filter(Boolean)).toHaveLength(30);
    const address = ip('factor-ip');
    const perIp = await Promise.all(
      Array.from({ length: 40 }, (_, index) => {
        const otherUser = `${prefix}-factor-${index}`;

        keys.add(`auth:factor:user:${otherUser}`);

        return consumeFactorVerificationLimit(otherUser, address);
      }),
    );

    expect(perIp.filter(Boolean)).toHaveLength(30);
  });

  it('fails closed when Redis rejects limiter scripts, without calling the next middleware', async () => {
    const redis = getRedis();
    const next = jest.fn();
    const res = response();

    await redis.acl('SETUSER', 'default', '-eval');
    try {
      await expect(
        emailOtpDeliveryRateLimit(
          request(ip('denied-delivery'), { email: destination('denied'), flowId: randomUUID() }),
          res as unknown as Response,
          next,
        ),
      ).rejects.toThrow(/NOPERM/);
      await expect(
        authenticationRateLimit(request(ip('denied-verification')), res as unknown as Response, next),
      ).rejects.toThrow(/NOPERM/);
      await expect(consumeFactorVerificationLimit(`${prefix}-denied`, ip('denied-factor'))).rejects.toThrow(/NOPERM/);
      expect(next).not.toHaveBeenCalled();
    } finally {
      await redis.acl('SETUSER', 'default', '+eval');
    }
  });

  it('does not authorize during an observed outage of the owned Redis', async () => {
    const redis = getRedis();
    const closed = new Promise<void>((resolve) => redis.once('close', () => resolve()));

    // PID was checked against INFO above; only the task-owned server is stopped.
    process.kill(Number(process.env.AUTH_REDIS_OWNED_PID), 'SIGTERM');
    await closed;
    const results: string[] = [];
    const pending = [
      consumeEmailOtpDeliveryLimit(ip('offline-delivery'), destination('offline'), true),
      consumeAuthenticationVerificationLimit(request(ip('offline-verification'))),
      consumeFactorVerificationLimit(`${prefix}-offline`, ip('offline-factor')),
    ].map((operation) =>
      operation.then(
        () => results.push('resolved'),
        () => results.push('rejected'),
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(results).not.toContain('resolved');
    console.info(
      `Real Redis outage: ${results.length}/3 settled after 300ms; ${results.filter((result) => result === 'resolved').length} resolved.`,
    );
    // Observation above uses unmodified production retry settings. Only now,
    // disable retries for teardown so the next failed connection releases the
    // queued operations and closes the client without a dangling retry loop.
    redis.options.retryStrategy = null;
    await Promise.all(pending);
  });
});
