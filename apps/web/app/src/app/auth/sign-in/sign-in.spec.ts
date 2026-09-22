import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Auth } from '../../shared/auth/auth';
import { GoogleIdentity } from '../../shared/auth/google-identity';
import { Passkey } from '../../shared/auth/passkey';
import { PasswordAuth } from '../../shared/auth/password';
import { Settings } from '../../shared/settings';

import { SignIn } from './sign-in';

describe('SignIn', () => {
  let fixture: ComponentFixture<SignIn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SignIn],
      providers: [
        provideRouter([]),
        {
          provide: Auth,
          useValue: {
            emailOtpSubmitting: () => false,
            isAuthenticated: () => false,
            passkeySubmitting: () => false,
            sessionLoaded: () => true,
            user: () => null,
            startIdentityFlow: vi.fn(),
          },
        },
        {
          provide: Passkey,
          useValue: {
            isSupported: () => true,
            supportsConditionalAuthentication: async () => false,
            supportsImmediateAuthentication: async () => false,
          },
        },
        { provide: GoogleIdentity, useValue: { renderButton: vi.fn() } },
        {
          provide: PasswordAuth,
          useValue: {
            signIn: vi.fn(),
            setPassword: vi.fn(),
            verify: vi.fn(),
            resend: vi.fn(),
          },
        },
        {
          provide: Settings,
          useValue: {
            isDark: () => false,
            theme: () => 'light',
            applyTheme: vi.fn(),
            setTheme: vi.fn(),
            toggleTheme: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SignIn);
    fixture.detectChanges();
  });

  it('presents the available sign-in methods without exposing password by default', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Secure account access');
    expect(text).toContain('Continue with a passkey');
    expect(text).not.toContain('Continue with Google');
    expect(text).toContain('Choose how to continue');
    expect(text).not.toContain('Sign in with password');
  });

  it('keeps email recovery as an explicit separate path', () => {
    const recoveryButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Recover with email'),
    ) as HTMLButtonElement;

    recoveryButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent as string).toContain('Email verification');
    expect(fixture.nativeElement.querySelector('input[type="email"]')).not.toBeNull();
  });

  it('only reveals password sign-in after an explicit choice', () => {
    const passwordButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Use password instead'),
    ) as HTMLButtonElement;

    expect(fixture.nativeElement.textContent as string).not.toContain('Sign in with password');

    passwordButton.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent as string).toContain('Sign in with password');
    expect(fixture.nativeElement.querySelector('input[autocomplete="current-password"]')).not.toBeNull();
  });

  it('redirects a correctly authenticated but unverified password user to email verification', async () => {
    const identity = fixture.componentInstance;
    const password = TestBed.inject(PasswordAuth) as unknown as { signIn: ReturnType<typeof vi.fn> };
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    identity.passwordModel.set({ email: 'person@example.test', password: 'a secure password' });
    identity.state.set('password');
    password.signIn.mockRejectedValue(new HttpErrorResponse({ status: 403, error: { code: 'email_unverified' } }));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/auth/verify'], {
      queryParams: { email: 'person@example.test' },
    });
  });

  it('offers optional password setup before passkey enrollment', async () => {
    const identity = fixture.componentInstance;
    const password = TestBed.inject(PasswordAuth) as unknown as { setPassword: ReturnType<typeof vi.fn> };

    identity.selectedAccount.set({ accountId: 'account-1', name: 'Workspace', role: 'owner' });
    identity.state.set('password-setup');
    identity.passwordSetupModel.set({ password: 'a'.repeat(15), confirmation: 'a'.repeat(15) });
    password.setPassword.mockResolvedValue({ passwordSet: true });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent as string).toContain('Set a password');
    expect(fixture.nativeElement.querySelectorAll('input[type="password"]').length).toBe(2);

    const skip = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Skip and create a passkey instead'),
    ) as HTMLButtonElement;

    skip.click();
    fixture.detectChanges();

    expect(identity.state()).toBe('enrollment');

    identity.state.set('password-setup');
    fixture.detectChanges();
    const submit = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Set password'),
    ) as HTMLButtonElement;

    submit.click();
    await fixture.whenStable();

    expect(password.setPassword).toHaveBeenCalledWith({ password: 'a'.repeat(15) });
    expect(identity.state()).toBe('password-setup-success');
  });

  it('prevents early resends and refreshes the deadline when the tab becomes visible', async () => {
    const identity = fixture.componentInstance;
    const password = TestBed.inject(PasswordAuth);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);

    try {
      identity.state.set('password-factor');
      identity.passwordFactor.set('email');
      identity.flowId.set('flow-1');
      identity.resendAvailableAt.set(new Date(now + 30_000).toISOString());
      fixture.detectChanges();
      await fixture.whenStable();
      const resend = () =>
        Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((button) =>
          button.textContent?.includes('Resend code'),
        )!;

      expect(resend().disabled).toBe(true);
      resend().click();
      expect(password.resend).not.toHaveBeenCalled();
      clock.mockReturnValue(now + 30_000);
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();
      expect(resend().disabled).toBe(false);
      vi.mocked(password.resend).mockResolvedValue({
        flowId: 'flow-1',
        resendAvailableAt: new Date(now + 60_000).toISOString(),
      });
      resend().click();
      await fixture.whenStable();
      expect(password.resend).toHaveBeenCalledExactlyOnceWith('flow-1');
      expect(resend().disabled).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('We sent a new code');
    } finally {
      clock.mockRestore();
    }
  });

  it('offers a restart for expired verification without exposing raw server text', async () => {
    const identity = fixture.componentInstance;
    const password = TestBed.inject(PasswordAuth);

    identity.state.set('password-factor');
    identity.passwordFactor.set('totp');
    identity.flowId.set('flow-1');
    identity.otpModel.set({ pin: '012345' });
    vi.mocked(password.verify).mockRejectedValue(
      new HttpErrorResponse({
        status: 410,
        error: { code: 'challenge_expired', message: 'Internal secret diagnostic' },
      }),
    );
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(identity.verificationRestartRequired()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Start verification again');
    expect(fixture.nativeElement.textContent).not.toContain('Internal secret diagnostic');
    expect(fixture.nativeElement.textContent).not.toContain('Resend code');
  });

  it('opens alternatives after a passkey error without starting a new native request', async () => {
    const identity = fixture.componentInstance;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');

    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });

    identity.emailModel.set({ email: 'person@example.test' });
    identity.state.set('passkey-error');
    identity.errorMessage.set('Previous error');
    fixture.detectChanges();
    const alternate = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.includes('Use another method'))!;

    try {
      alternate.click();
      await fixture.whenStable();
      expect(identity.state()).toBe('ready');
      expect(identity.methodsOpen()).toBe(true);
      expect(identity.emailModel().email).toBe('person@example.test');
      expect(fixture.nativeElement.querySelector('dialog')?.open).toBe(true);
    } finally {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    }
  });

  it('clears the old recovery challenge when changing the email', async () => {
    const identity = fixture.componentInstance;

    identity.state.set('otp');
    identity.identityFlowId.set('old-flow');
    identity.flowId.set('old-flow');
    identity.otpModel.set({ pin: '012345' });
    identity.emailModel.set({ email: 'person@example.test' });
    fixture.detectChanges();
    const change = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (button) => button.textContent?.includes('Change email'),
    )!;

    change.click();
    await fixture.whenStable();
    expect(identity.state()).toBe('email');
    expect(identity.flowId()).toBe('');
    expect(identity.identityFlowId()).toBe('');
    expect(identity.otpModel().pin).toBe('');
    expect(identity.emailModel().email).toBe('person@example.test');
  });
});
