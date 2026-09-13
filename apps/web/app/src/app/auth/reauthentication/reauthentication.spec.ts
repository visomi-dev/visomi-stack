import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Auth } from '../../shared/auth/auth';
import { Passkey } from '../../shared/auth/passkey';
import { Settings } from '../../shared/settings';
import { SecurityAuth } from '../../shared/auth/security-auth';

import { Reauthentication } from './reauthentication';

describe('Reauthentication', () => {
  let fixture: ComponentFixture<Reauthentication>;
  let passkey: {
    beginAuthentication: ReturnType<typeof vi.fn>;
    getCredential: ReturnType<typeof vi.fn>;
    completeAuthentication: ReturnType<typeof vi.fn>;
  };
  let security: { startReauthentication: ReturnType<typeof vi.fn>; completeReauthentication: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    passkey = {
      beginAuthentication: vi.fn().mockResolvedValue({ challengeId: 'challenge-1', options: {} }),
      getCredential: vi.fn().mockResolvedValue({ id: 'credential-1' }),
      completeAuthentication: vi.fn().mockResolvedValue(undefined),
    };
    security = {
      startReauthentication: vi.fn().mockResolvedValue({ grantId: 'grant-1', methods: ['passkey'] }),
      completeReauthentication: vi.fn().mockResolvedValue({ grantId: 'grant-1', authenticated: true }),
    };
    await TestBed.configureTestingModule({
      imports: [Reauthentication],
      providers: [
        provideRouter([]),
        { provide: Passkey, useValue: passkey },
        { provide: SecurityAuth, useValue: security },
        { provide: Auth, useValue: { ensureSessionLoaded: vi.fn().mockResolvedValue(undefined) } },
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

    fixture = TestBed.createComponent(Reauthentication);
    fixture.detectChanges();
  });

  it('performs an existing passkey ceremony without claiming a new credential', async () => {
    const confirm = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Confirm with passkey'),
    ) as HTMLButtonElement;

    confirm.click();
    await fixture.whenStable();

    expect(passkey.beginAuthentication).toHaveBeenCalledOnce();
    expect(passkey.completeAuthentication).toHaveBeenCalledWith('challenge-1', { id: 'credential-1' });
    expect(security.startReauthentication).toHaveBeenCalledWith('password_change');
    expect(security.completeReauthentication).toHaveBeenCalledWith({ grantId: 'grant-1', method: 'passkey' });
    expect(fixture.componentInstance.confirmed()).toBe(true);
  });
});
