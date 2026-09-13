import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Auth } from '../../shared/auth/auth';
import { GoogleIdentity } from '../../shared/auth/google-identity';
import { Passkey } from '../../shared/auth/passkey';
import { PasswordAuth } from '../../shared/auth/password';
import { Settings } from '../../shared/settings';

import { Identity } from './identity';

describe('Identity', () => {
  let fixture: ComponentFixture<Identity>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Identity],
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

    fixture = TestBed.createComponent(Identity);
    fixture.detectChanges();
  });

  it('presents the available sign-in methods without exposing password by default', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Secure account access');
    expect(text).toContain('Continue with a passkey');
    expect(text).toContain('Continue with Google');
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
});
