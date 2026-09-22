import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { SecurityAction } from '../security-action';
import { SecurityAuth } from '../security-auth';
import { Passkey } from '../passkey';
import { GoogleIdentity } from '../google-identity';

import { SecurityConfirmation } from './security-confirmation';

describe('SecurityConfirmation', () => {
  it('uses the official Google button and runs the owning action once, ignoring stale callbacks', async () => {
    const callbacks: Array<(token: string) => Promise<void>> = [];
    const active: Array<() => boolean> = [];
    let sequence = 0;
    let finish: (() => void) | undefined;
    const completeReauthentication = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const renderReauthenticationButton = vi.fn(async (_element, _clientId, _nonce, callback, isActive) => {
      callbacks.push(callback);
      active.push(isActive);
    });

    await TestBed.configureTestingModule({
      imports: [SecurityConfirmation],
      providers: [
        SecurityAction,
        { provide: Passkey, useValue: {} },
        {
          provide: SecurityAuth,
          useValue: {
            startReauthentication: vi.fn(async () => ({
              grantId: `grant-${++sequence}`,
              methods: ['google'],
              google: { clientId: 'google-client', nonce: `nonce-${sequence}` },
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              passwordRequiresTotp: false,
            })),
            completeReauthentication,
          },
        },
        { provide: GoogleIdentity, useValue: { renderReauthenticationButton } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SecurityConfirmation);
    const action = TestBed.inject(SecurityAction);
    const mutation = vi.fn(async () => undefined);
    const context = {
      summary: 'Enroll your first passkey',
      targetId: 'passkey',
      authority: 'operation',
      purpose: 'passkey_enroll',
    } as const;
    const cancelled = action.run(context, mutation);

    await fixture.whenStable();
    expect(renderReauthenticationButton).toHaveBeenCalledOnce();
    expect(renderReauthenticationButton.mock.calls[0].slice(1, 3)).toEqual(['google-client', 'nonce-1']);
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    action.cancel();
    await cancelled;
    const result = action.run(context, mutation);

    await fixture.whenStable();
    expect(active[0]()).toBe(false);
    await callbacks[0]('stale-token');
    expect(completeReauthentication).not.toHaveBeenCalled();
    const confirming = callbacks[1]('fresh-token');

    await callbacks[1]('duplicate-token');
    expect(completeReauthentication).toHaveBeenCalledExactlyOnceWith({
      grantId: 'grant-2',
      method: 'google',
      password: '',
      code: '',
      idToken: 'fresh-token',
    });
    finish!();
    await confirming;
    await result;
    await callbacks[1]('late-token');
    expect(mutation).toHaveBeenCalledExactlyOnceWith('grant-2');
    expect(completeReauthentication).toHaveBeenCalledOnce();
  });

  it('shows the pending action and only the permitted confirmation methods', async () => {
    const confirm = vi.fn();

    await TestBed.configureTestingModule({
      imports: [SecurityConfirmation],
      providers: [
        {
          provide: SecurityAction,
          useValue: {
            pending: signal({ summary: 'Replace recovery codes', targetId: 'codes' }),
            methods: signal(['passkey']),
            busy: signal(false),
            error: signal(''),
            passwordRequiresTotp: signal(false),
            google: signal(undefined),
            confirm,
            cancel: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SecurityConfirmation);

    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Replace recovery codes');
    expect(fixture.nativeElement.textContent).not.toContain('Use password');
    const button = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (item) => item.textContent?.includes('Continue with a passkey'),
    )!;

    button.click();
    expect(confirm).toHaveBeenCalledExactlyOnceWith('passkey');
  });
});
