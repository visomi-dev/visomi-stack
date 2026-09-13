import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Auth } from '../../shared/auth/auth';
import { Settings } from '../../shared/settings';

import { EmailVerification } from './email-verification';

describe('EmailVerification', () => {
  let fixture: ComponentFixture<EmailVerification>;
  let auth: { requestEmailOtp: ReturnType<typeof vi.fn>; verifyEmailOtp: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    auth = {
      requestEmailOtp: vi.fn().mockResolvedValue({ flowId: 'flow-1', resendAvailableAt: '' }),
      verifyEmailOtp: vi.fn().mockResolvedValue({ kind: 'restricted', authenticated: false, user: null }),
    };
    await TestBed.configureTestingModule({
      imports: [EmailVerification],
      providers: [
        provideRouter([]),
        { provide: Auth, useValue: auth },
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

    fixture = TestBed.createComponent(EmailVerification);
    fixture.componentInstance.emailModel.set({ email: 'person@example.test' });
    fixture.detectChanges();
  });

  it('requests a verification code through the auth contract', async () => {
    (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(auth.requestEmailOtp).toHaveBeenCalledWith({ email: 'person@example.test' });
    expect(fixture.componentInstance.flowId()).toBe('flow-1');
  });

  it('does not treat a restricted verification as a full sign-in', async () => {
    fixture.componentInstance.flowId.set('flow-1');
    fixture.componentInstance.codeModel.set({ pin: '123456' });
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('button[type="submit"]');

    (buttons[0] as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(auth.verifyEmailOtp).toHaveBeenCalledWith({ flowId: 'flow-1', pin: '123456' });
    expect(fixture.componentInstance.complete()).toBe(true);
  });
});
