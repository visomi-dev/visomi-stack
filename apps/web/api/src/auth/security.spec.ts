import type { Database } from '@visomi-stack/backend-shared';
import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { authConfig } from './config';
import { csrf, rateLimit, requireFresh } from './security';

const config = authConfig({
  origin: 'http://localhost',
  rpId: 'localhost',
  secret: 'synthetic-session-secret-with-32-bytes',
});

describe('authentication request protections', () => {
  it('allows preflight without accessing shared rate-limit storage', async () => {
    const execute = vi.fn();
    const next = vi.fn();

    await rateLimit({ execute } as unknown as Database, config)({ method: 'OPTIONS' } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses the unknown-address bucket when no address is available', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ attempts: 1 }] });
    const next = vi.fn();

    await rateLimit({ execute } as unknown as Database, config)({ method: 'POST' } as Request, {} as Response, next);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });
  it.each([
    ['POST', 'http://localhost', 'token', undefined],
    ['POST', 'http://other.test', 'token', 'csrf_invalid'],
    ['POST', 'http://localhost', 'wrong', 'csrf_invalid'],
    ['POST', undefined, 'token', 'csrf_invalid'],
    ['GET', undefined, undefined, undefined],
  ])('checks the trusted origin and session token for %s', (method, origin, supplied, code) => {
    const next = vi.fn();
    const request = {
      method,
      session: { csrf: 'token' },
      get: (key: string) => (key === 'origin' ? origin : supplied),
    } as unknown as Request;

    csrf(config)(request, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0]?.code).toBe(code);
    if (code) {
      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthHttpError);
      expect(next.mock.calls[0][0].status).toBe(403);
    }
  });

  it('uses shared PostgreSQL state and rejects either per-address or global exhaustion', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ attempts: 1 }] })
      .mockResolvedValueOnce({ rows: [{ attempts: 1001 }] });
    const next = vi.fn();
    const response = { setHeader: vi.fn() } as unknown as Response;

    await rateLimit({ execute } as unknown as Database, config)(
      { method: 'POST', ip: 'synthetic-address' } as Request,
      response,
      next,
    );
    expect(execute).toHaveBeenCalledTimes(2);
    expect(next.mock.calls[0][0]).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(next.mock.calls[0][0]).toBeInstanceOf(HttpError);
    expect(next.mock.calls[0][0]).not.toBeInstanceOf(AuthHttpError);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('fails closed if shared rate-limit storage is unavailable', async () => {
    const next = vi.fn();
    const middleware = rateLimit(
      { execute: vi.fn().mockRejectedValue(new Error('SYNTHETIC_PRIVATE_SQL')) } as unknown as Database,
      config,
    );

    await expect(
      middleware({ method: 'POST', ip: 'synthetic-address' } as Request, {} as Response, next),
    ).rejects.toThrow();
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts fresh authentication and rejects anonymous, stale and future-dated assertions', () => {
    const user = { id: 'synthetic', credentialId: 'synthetic', authenticatedAt: Date.now() };

    expect(requireFresh(user, config)).toBe(user);
    expect(() => requireFresh(undefined, config)).toThrow('authentication_required');
    expect(() => requireFresh(undefined, config)).toThrow(AuthHttpError);
    expect(() => requireFresh({ ...user, authenticatedAt: NaN }, config)).toThrow('reauthentication_required');
    expect(() => requireFresh({ ...user, authenticatedAt: Date.now() + 60000 }, config)).toThrow(
      'reauthentication_required',
    );
  });
});
