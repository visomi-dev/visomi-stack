import { TestBed } from '@angular/core/testing';

import { SecurityAction } from './security-action';
import { SecurityAuth } from './security-auth';
import { Passkey } from './passkey';

describe('SecurityAction', () => {
  const context = {
    authority: 'operation',
    purpose: 'password_change',
    targetId: 'password',
    summary: 'Change password',
  } as const;

  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        SecurityAction,
        {
          provide: SecurityAuth,
          useValue: {
            startReauthentication: vi.fn().mockResolvedValue({
              grantId: 'grant',
              methods: ['password'],
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              passwordRequiresTotp: true,
            }),
            completeReauthentication: vi.fn().mockResolvedValue({ authenticated: true }),
          },
        },
        { provide: Passkey, useValue: {} },
      ],
    }),
  );

  it('does not mutate before verification and ignores duplicate confirmation', async () => {
    const action = TestBed.inject(SecurityAction);
    const mutation = vi.fn().mockResolvedValue('saved');
    const result = action.run(context, mutation);

    await Promise.resolve();
    expect(mutation).not.toHaveBeenCalled();
    expect(action.passwordRequiresTotp()).toBe(true);
    await Promise.all([action.confirm('password', 'secret', '123456'), action.confirm('password', 'secret', '123456')]);
    const saved = await result;

    expect(saved).toBe('saved');
    expect(mutation).toHaveBeenCalledExactlyOnceWith('grant');
    expect(TestBed.inject(SecurityAuth).completeReauthentication).toHaveBeenCalledExactlyOnceWith({
      grantId: 'grant',
      method: 'password',
      password: 'secret',
      code: '123456',
    });
  });

  it('cancels without consuming authority or invoking the mutation', async () => {
    const action = TestBed.inject(SecurityAction);
    const mutation = vi.fn();
    const result = action.run(context, mutation);

    await Promise.resolve();
    action.cancel();
    await action.confirm('password', 'secret');
    const cancelled = await result;

    expect(cancelled).toBeUndefined();
    expect(mutation).not.toHaveBeenCalled();
    expect(TestBed.inject(SecurityAuth).completeReauthentication).not.toHaveBeenCalled();
  });

  it('does not automatically replay a mutation whose outcome is unknown', async () => {
    const action = TestBed.inject(SecurityAction);
    const mutation = vi.fn().mockRejectedValue(new Error('Connection lost'));
    const result = action.run(context, mutation);
    const rejection = expect(result).rejects.toThrow('Connection lost');

    await Promise.resolve();
    await action.confirm('password', 'secret', '123456');
    await rejection;
    await action.confirm('password', 'secret', '123456');
    expect(mutation).toHaveBeenCalledOnce();
    expect(action.pending()).toBeNull();
  });

  it.each(['expired', 'malformed'] as const)(
    'rejects a grant with an %s expiry before consuming authority',
    async (expiry) => {
      const security = TestBed.inject(SecurityAuth);

      vi.mocked(security.startReauthentication).mockResolvedValueOnce({
        grantId: 'invalid-grant',
        methods: ['password'],
        expiresAt: expiry === 'expired' ? '2020-01-01T00:00:00Z' : 'invalid',
        passwordRequiresTotp: false,
      });
      const action = TestBed.inject(SecurityAction);
      const mutation = vi.fn();
      const pending = action.run(context, mutation);

      await Promise.resolve();
      await action.confirm('password', 'synthetic-secret');
      expect(mutation).not.toHaveBeenCalled();
      expect(security.completeReauthentication).not.toHaveBeenCalled();
      expect(action.error()).toContain('expired');
      expect(action.methods()).toEqual([]);
      action.cancel();
      await pending;
    },
  );

  it('binds the visible confirmation to an immutable copy of the requested target', async () => {
    const action = TestBed.inject(SecurityAction);
    const mutable = { ...context };
    const pending = action.run(mutable, vi.fn());

    Object.assign(mutable, { summary: 'Another request', targetId: 'another-target' });
    await Promise.resolve();
    expect(action.pending()?.summary).toBe('Change password');
    expect(action.pending()?.targetId).toBe('password');
    expect(Object.isFrozen(action.pending())).toBe(true);
    action.cancel();
    await pending;
  });

  it('invalidates an in-flight factor before it can release a mutation', async () => {
    const security = TestBed.inject(SecurityAuth);
    let release: () => void = () => undefined;

    vi.mocked(security.completeReauthentication).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ authenticated: true });
        }),
    );
    const action = TestBed.inject(SecurityAction);
    const mutation = vi.fn();
    const pending = action.run(context, mutation);

    await Promise.resolve();
    const confirming = action.confirm('password', 'synthetic-secret');

    action.invalidate();
    release();
    await confirming;
    const cancelled = await pending;

    expect(cancelled).toBeUndefined();
    expect(mutation).not.toHaveBeenCalled();
    expect(action.pending()).toBeNull();
    expect(action.busy()).toBe(false);
  });

  it('does not let late preparation replace a newer confirmation', async () => {
    const security = TestBed.inject(SecurityAuth);
    let release: (value: Awaited<ReturnType<SecurityAuth['startReauthentication']>>) => void = () => undefined;

    vi.mocked(security.startReauthentication).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const action = TestBed.inject(SecurityAction);
    const oldMutation = vi.fn();
    const old = action.run(context, oldMutation);

    action.invalidate();
    const current = action.run({ ...context, targetId: 'current-target' }, vi.fn());

    await Promise.resolve();
    release({
      grantId: 'old-grant',
      methods: ['totp'],
      expiresAt: '2099-01-01T00:00:00Z',
      passwordRequiresTotp: false,
    });
    await Promise.resolve();
    expect(action.pending()?.targetId).toBe('current-target');
    expect(action.methods()).toEqual(['password']);
    expect(oldMutation).not.toHaveBeenCalled();
    action.cancel();
    await old;
    await current;
  });
});
