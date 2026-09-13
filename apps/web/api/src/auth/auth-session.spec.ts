import type { Request, Response } from 'express';

import { establishFullSession, type FullAuthUser } from './auth-session';

describe('establishFullSession', () => {
  it.each(['passkey', 'google'] as const)('persists %s metadata without a second factor', async (method) => {
    const login = jest.fn((_user: Express.User, done: (error?: Error) => void) => done());
    const req = {
      login,
      session: {
        secondFactor: 'email' as const,
        cookie: {},
      },
    } as unknown as Request;
    const res = { cookie: jest.fn() } as unknown as Response;
    const user = {
      accountId: 'account-1',
      authority: 'full' as const,
      authenticationMethod: method,
      authVersion: 7,
      email: 'person@example.test',
      emailVerifiedAt: new Date().toISOString(),
      id: 'user-1',
      role: 'owner',
    } satisfies FullAuthUser;

    await establishFullSession(req, res, user);

    expect(login).toHaveBeenCalledWith(user, expect.any(Function));
    expect(req.session).toEqual(
      expect.objectContaining({
        authenticationMethod: method,
        authVersion: 7,
        authority: 'full',
      }),
    );
    expect(req.session.secondFactor).toBeUndefined();
  });
});
