import type { Database } from '@visomi-stack/backend-shared';
import { AuthHttpError, HttpError } from '@visomi-stack/web-backend-shared';
import type { Request, RequestHandler, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { authService } from '../../../tests/support/injection';

import { authConfig } from './config';
import { RequestLimitStore } from './request-limit-store';
import { csrf, rateLimit, requireFresh } from './security';

const config = authConfig({
  origin: 'http://localhost',
  rpId: 'localhost',
  secret: 'synthetic-session-secret-with-32-bytes',
});

function limits(execute: Database['execute']) {
  return rateLimit(authService(RequestLimitStore, { execute } as Database, config), config);
}

function invoke(middleware: RequestHandler, request: Partial<Request>, response = {} as Response) {
  return new Promise<Error | undefined>((resolve) =>
    middleware({ url: '/', ...request } as Request, response, (error) => resolve(error)),
  );
}

describe('authentication request protections', () => {
  it('allows preflight without accessing shared rate-limit storage', async () => {
    const execute = vi.fn();
    const result = await invoke(limits(execute), { method: 'OPTIONS' });

    expect(result).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses the unknown-address bucket when no address is available', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ attempts: 1 }] });
    const result = await invoke(limits(execute), { method: 'POST' });

    expect(result).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
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

  it.each([61, 1001])('rejects exhaustion of shared PostgreSQL counters at %s hits', async (count) => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ attempts: count === 61 ? count : 1 }] })
      .mockResolvedValueOnce({ rows: [{ attempts: count }] });
    const response = { setHeader: vi.fn() } as unknown as Response;

    const error = await invoke(limits(execute), { method: 'POST', ip: 'synthetic-address' }, response);

    expect(execute).toHaveBeenCalledTimes(count === 61 ? 1 : 2);
    expect(error).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(error).toBeInstanceOf(HttpError);
    expect(error).not.toBeInstanceOf(AuthHttpError);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('fails closed if shared rate-limit storage is unavailable', async () => {
    const middleware = limits(vi.fn().mockRejectedValue(new Error('SYNTHETIC_PRIVATE_SQL')));

    const error = await invoke(middleware, { method: 'POST', ip: 'synthetic-address' });

    expect(error).toBeInstanceOf(Error);
  });

  it('rejects counter rollback and reset instead of exposing ways to bypass shared limits', () => {
    const store = authService(RequestLimitStore, {} as Database, config);

    expect(() => store.decrement()).toThrow('rate_limit_decrement_disabled');
    expect(() => store.resetKey()).toThrow('rate_limit_reset_disabled');
  });

  it('creates no maintenance timers and discards third-party diagnostics without client data', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      // An invalid synthetic store response triggers the library's diagnostic path.
      const execute = vi.fn().mockResolvedValue({ rows: [{ attempts: 0 }] });
      const result = await invoke(limits(execute), { method: 'POST', ip: 'SYNTHETIC_PRIVATE_ADDRESS' });

      expect(result).toBeUndefined();
      expect(errors).not.toHaveBeenCalled();
      expect(warnings).not.toHaveBeenCalled();
      expect(intervals).not.toHaveBeenCalled();
    } finally {
      intervals.mockRestore();
      errors.mockRestore();
      warnings.mockRestore();
    }
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
