import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PasswordAuth } from '../../shared/auth/password';
import { Passkey } from '../../shared/auth/passkey';
import { SecurityAuth } from '../../shared/auth/security-auth';
import { Settings } from '../../shared/settings';

import { PasswordManagement } from './password-management';

describe('PasswordManagement', () => {
  let fixture: ComponentFixture<PasswordManagement>;
  let password: { startTotpSetup: ReturnType<typeof vi.fn>; confirmTotp: ReturnType<typeof vi.fn> };
  let passkey: {
    beginAuthentication: ReturnType<typeof vi.fn>;
    getCredential: ReturnType<typeof vi.fn>;
    completeAuthentication: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    password = {
      startTotpSetup: vi.fn().mockResolvedValue({ enrollmentId: 'enrollment-1', secret: 'JBSWY3DPEHPK3PXP' }),
      confirmTotp: vi.fn().mockResolvedValue({ enabled: true, recoveryCodes: ['ABCD-1234'] }),
    };
    passkey = {
      beginAuthentication: vi.fn().mockResolvedValue({ challengeId: 'challenge-1', options: {} }),
      getCredential: vi.fn().mockResolvedValue({ id: 'credential-1' }),
      completeAuthentication: vi.fn().mockResolvedValue(undefined),
    };
    await TestBed.configureTestingModule({
      imports: [PasswordManagement],
      providers: [
        provideRouter([]),
        { provide: PasswordAuth, useValue: password },
        { provide: Passkey, useValue: passkey },
        {
          provide: SecurityAuth,
          useValue: {
            startReauthentication: vi.fn().mockResolvedValue({ grantId: 'grant-1', methods: ['passkey'] }),
            completeReauthentication: vi.fn().mockResolvedValue({ grantId: 'grant-1', authenticated: true }),
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

    fixture = TestBed.createComponent(PasswordManagement);
    fixture.detectChanges();
  });

  it('starts TOTP setup and displays the server-provided secret', async () => {
    const setup = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Set up authenticator'),
    ) as HTMLButtonElement;

    setup.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(password.startTotpSetup).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).toContain('JBSWY3DPEHPK3PXP');
  });

  it('confirms TOTP using the server enrollment id', async () => {
    fixture.componentInstance.enrollmentId.set('enrollment-1');
    fixture.componentInstance.secret.set('secret');
    fixture.componentInstance.codeModel.set({ code: '123456' });
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(password.confirmTotp).toHaveBeenCalledWith('enrollment-1', '123456');
    expect(fixture.componentInstance.enabled()).toBe(true);
  });
});
