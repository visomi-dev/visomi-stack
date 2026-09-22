import type { Request, Response } from 'express';

import { establishFullSession, type FullAuthUser } from './auth-session';

describe('establishFullSession', () => {
  it.each([false, true])('waits for the complete save and propagates failure=%s', async (failed) => {
    let finish!: (error?: Error) => void;
    const req = {
      isAuthenticated: () => false,
      login: (_user: Express.User, done: () => void) => done(),
      session: {
        cookie: {},
        save: (done: (error?: Error) => void) => {
          finish = done;
        },
      },
    } as unknown as Request;
    const res = { cookie: jest.fn() } as unknown as Response;
    const user: FullAuthUser = {
      id: 'user-1',
      accountId: 'account-1',
      email: 'person@example.test',
      emailVerifiedAt: null,
      role: 'owner',
      authority: 'full',
      authenticationMethod: 'passkey',
      authVersion: 7,
    };
    let settled = false;
    const pending = establishFullSession(req, res, user);
    const outcome = pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await Promise.resolve();
    expect(finish).toBeDefined();
    expect(settled).toBe(false);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(req.session.authority).toBe('full');
    const error = failed ? new Error('Session save failed') : undefined;

    finish(error);
    if (error) {
      await expect(pending).rejects.toBe(error);
      expect(res.cookie).not.toHaveBeenCalled();
    } else {
      await pending;
      expect(res.cookie).toHaveBeenCalled();
    }
    await outcome;
  });

  it.each(['passkey', 'google'] as const)('persists %s metadata without a second factor', async (method) => {
    const login = jest.fn((_user: Express.User, done: (error?: Error) => void) => done());
    const req = {
      isAuthenticated: () => false,
      login,
      session: {
        save: jest.fn((done: (error?: Error) => void) => done()),
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
    expect(req.session.save).toHaveBeenCalledTimes(1);
  });
});
