import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Sessions as SessionApi } from '../../shared/auth/sessions';
import { SecurityAction } from '../../shared/auth/security-action';
import { Auth } from '../../shared/auth/auth';

import { Sessions } from './sessions';

describe('Sessions', () => {
  const items = [
    {
      id: 'current',
      current: true,
      method: 'password',
      startedAt: '2026-01-01T00:00:00Z',
      lastActiveAt: '2026-01-02T00:00:00Z',
      expiresAt: '2026-01-03T00:00:00Z',
    },
    {
      id: 'other',
      current: false,
      method: 'passkey',
      startedAt: '2026-01-01T00:00:00Z',
      lastActiveAt: '2026-01-02T00:00:00Z',
      expiresAt: '2026-01-03T00:00:00Z',
    },
  ];
  const api = { list: vi.fn(), revoke: vi.fn() };
  const auth = { signOut: vi.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    api.list.mockReset().mockResolvedValue(items);
    api.revoke.mockReset().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [Sessions],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: SessionApi, useValue: api },
        { provide: Auth, useValue: auth },
      ],
    }).compileComponents();
  });
  it('marks the current session and offers selected revocation only for another session', async () => {
    const fixture = TestBed.createComponent(Sessions);

    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;

    expect(element.textContent).toContain('Current session');
    expect(element.textContent).toContain('Password');
    expect(element.textContent).toContain('Passkey');
    expect(
      Array.from(element.querySelectorAll('button')).filter(
        (button) => button.textContent?.trim() === 'Sign out this session',
      ),
    ).toHaveLength(1);
  });
  it('binds confirmation to the selected session before revoking and refreshing', async () => {
    const fixture = TestBed.createComponent(Sessions);

    await fixture.whenStable();
    const action = fixture.debugElement.injector.get(SecurityAction);
    const run = vi.spyOn(action, 'run').mockImplementation(async (_context, mutation) => mutation('verified-grant'));
    const element: HTMLElement = fixture.nativeElement;

    Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Sign out this session')!
      .click();
    await fixture.whenStable();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'sessions_revoke', targetId: 'other' }),
      expect.any(Function),
    );
    expect(api.revoke).toHaveBeenCalledWith('verified-grant', 'other');
    expect(api.list).toHaveBeenCalledTimes(2);
  });
  it('shows load failures with a retry instead of claiming that no sessions exist', async () => {
    api.list.mockRejectedValueOnce(new Error('offline'));
    const fixture = TestBed.createComponent(Sessions);

    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
  });

  it('uses normal sign-out for the current session without an operation grant', async () => {
    const fixture = TestBed.createComponent(Sessions);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;

    Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Sign out current session')!
      .click();
    await fixture.whenStable();
    expect(auth.signOut).toHaveBeenCalled();
    expect(api.revoke).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/auth/sign-in');
  });
});
