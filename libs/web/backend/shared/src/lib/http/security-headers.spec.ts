import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { securityHeaders } from './security-headers';

function headers(production?: boolean, nonce = false) {
  const values = new Map<string, string>();
  const response = {
    locals: {} as Record<string, string>,
    setHeader: (name: string, value: string) => values.set(name.toLowerCase(), value),
    removeHeader: vi.fn(),
  };
  const next = vi.fn();

  securityHeaders({ production, nonce })({} as Request, response as unknown as Response, next);

  return { values, next, response };
}

afterEach(() => vi.unstubAllEnvs());

describe('shared Helmet policy', () => {
  it('applies browser isolation and content protections without legacy product permissions', () => {
    const { values, next, response } = headers(false);
    const csp = values.get('content-security-policy');

    expect(values.get('x-content-type-options')).toBe('nosniff');
    expect(values.get('referrer-policy')).toBe('no-referrer');
    expect(values.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('accounts.google.com');
    expect(response.removeHeader).toHaveBeenCalledWith('X-Powered-By');
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it('allows local HTTP without setting persistent HTTPS policy', () => {
    const { values } = headers(false);

    expect(values.has('strict-transport-security')).toBe(false);
    expect(values.get('content-security-policy')).not.toContain('upgrade-insecure-requests');
  });

  it('enables production HTTPS policy for the current host', () => {
    const { values } = headers(true);

    expect(values.get('strict-transport-security')).toBe('max-age=31536000');
    expect(values.get('content-security-policy')).toContain('upgrade-insecure-requests');
  });

  it('chooses defaults at composition time and permits an explicit owner override', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(headers().values.has('strict-transport-security')).toBe(true);
    expect(headers(false).values.has('strict-transport-security')).toBe(false);
    vi.stubEnv('NODE_ENV', 'test');
    expect(headers().values.has('strict-transport-security')).toBe(false);
  });
  it('uses an unpredictable per-response nonce for scripts and styles without weakening attribute policy', () => {
    const first = headers(false, true);
    const second = headers(false, true);
    const nonce = first.response.locals['cspNonce'];
    const csp = first.values.get('content-security-policy');

    expect(nonce).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(second.response.locals['cspNonce']).not.toBe(nonce);
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}'`);
    expect(csp).toContain(`style-src 'self' 'nonce-${nonce}'`);
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).not.toContain('unsafe-inline');
  });
});
