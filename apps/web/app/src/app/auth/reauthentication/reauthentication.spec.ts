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

  it('does not authorize an arbitrary purpose when opened without an action', async () => {
    await fixture.whenStable();

    expect(passkey.beginAuthentication).not.toHaveBeenCalled();
    expect(security.startReauthentication).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Choose an action in Security first');
    expect(fixture.nativeElement.querySelector('a[href="/security"]')).not.toBeNull();
  });
});
