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
    expect(await result).toBe('saved');
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
    expect(await result).toBeUndefined();
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
});
