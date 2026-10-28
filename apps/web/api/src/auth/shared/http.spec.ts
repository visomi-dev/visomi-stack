import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { passwordContracts } from '../password/contract';

import { factorSchema, identifierSchema } from './contracts';
import { destroySession, sessionView } from './http';
import { requireFull, validPrincipal } from './identity';

describe('public authentication parsing and session projection', () => {
  it.each([null, [], {}, { kind: 'other', code: '123456' }, { kind: 'email', code: '123456', unexpected: true }])(
    'rejects invalid factor %j',
    (input) => {
      expect(factorSchema.safeParse(input).success).toBe(false);
    },
  );
  it('projects only public state for a migrated user who still needs an email', () => {
    const request = {
      user: { id: 'synthetic', level: 'unverified' },
      session: { csrf: 'synthetic' },
      isAuthenticated: () => true,
    } as unknown as Request;

    expect(sessionView(request)).toMatchObject({
      user: { email: null, emailVerified: false },
      method: null,
      nextStep: 'add_email',
    });
  });
  it('sanitizes failed destruction and invalid field shapes', async () => {
    const destroy = vi.fn((callback: (error: Error) => void) => callback(new Error('SYNTHETIC_PRIVATE_SQL')));

    await expect(destroySession({ session: { destroy } } as unknown as Request)).rejects.toMatchObject({
      code: 'session_unavailable',
    });
    expect(identifierSchema.safeParse('invalid').success).toBe(false);
    expect(passwordContracts.signIn.request.shape.body.safeParse([]).success).toBe(false);
  });
  it.each([
    { id: 'synthetic', version: 1, authenticatedAt: 1 },
    { id: 'synthetic', version: 1, authenticatedAt: 1, method: 'password' },
    { id: 'synthetic', version: 1, authenticatedAt: 1, method: 'password', level: 'other' },
    { id: 'synthetic', version: -1, authenticatedAt: 1, method: 'password', level: 'full' },
  ])('rejects malformed or legacy principals %j', (user) => {
    expect(validPrincipal(user)).toBe(false);
  });
  it('denies an unverified principal even when Passport considers it authenticated', () => {
    expect(() =>
      requireFull({
        id: 'synthetic',
        authenticatedAt: Date.now(),
        method: 'password',
        version: 1,
        level: 'unverified',
        emailVerified: false,
      }),
    ).toThrow('account_verification_required');
  });
});
