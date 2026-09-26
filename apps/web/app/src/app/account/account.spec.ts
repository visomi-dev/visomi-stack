import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';

import { AccountProfile } from '../shared/auth/account-profile';
import type { AccountProfileData } from '../shared/auth/account-profile';
import { Auth } from '../shared/auth/auth';
import { SecurityAction } from '../shared/auth/security-action';

import { Account } from './account';

describe('Account profile and workspace lifecycle', () => {
  let data: AccountProfileData;
  const originalLanguage = document.documentElement.lang;
  const api = {
    applyPreferences: vi.fn(),
    save: vi.fn(),
    requestEmail: vi.fn(),
    verifyEmail: vi.fn(),
    transfer: vi.fn(),
    leave: vi.fn(),
    exportMetadata: vi.fn(),
  };
  const auth = { ensureSessionLoaded: vi.fn() };

  beforeEach(async () => {
    document.documentElement.lang = 'en';
    vi.resetAllMocks();
    data = {
      profile: {
        id: 'user-1',
        email: 'old@example.test',
        emailVerifiedAt: '2026-01-01T00:00:00Z',
        displayName: 'Ada',
        preferences: { locale: 'en', theme: 'system' },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      memberships: [
        {
          accountId: 'selected-workspace',
          name: 'Selected workspace',
          role: 'member',
          joinedAt: '2026-01-01T00:00:00Z',
        },
      ],
      selectedAccountId: 'selected-workspace',
      isWorkspaceOwner: false,
      ownershipCandidates: [],
    };
    api.save.mockImplementation(async (update) => ({ ...data.profile, ...update, preferencesConfigured: true }));
    api.requestEmail.mockResolvedValue({
      flowId: 'email-flow',
      email: 'new@example.test',
      expiresAt: '2026-12-01T00:00:00Z',
    });
    api.verifyEmail.mockResolvedValue({ changed: true, notification: 'sent', signInRequired: true });
    api.leave.mockResolvedValue({ left: true, hasRemainingMemberships: true, signInRequired: true });
    await TestBed.configureTestingModule({
      imports: [Account],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { account: data } } } },
        { provide: AccountProfile, useValue: api },
        { provide: Auth, useValue: auth },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    document.documentElement.lang = originalLanguage;
  });

  it.each([false, undefined])(
    'initializes an unsaved Spanish profile from the active document language (%s)',
    async (preferencesConfigured) => {
      document.documentElement.lang = 'es';
      data.profile.preferencesConfigured = preferencesConfigured;
      const fixture = await render();
      const element: HTMLElement = fixture.nativeElement;

      expect(element.querySelector<HTMLSelectElement>('#profile-locale')?.value).toBe('es');
      expect(api.applyPreferences).not.toHaveBeenCalled();
      button(fixture, 'Save profile').click();
      await fixture.whenStable();
      expect(api.save).toHaveBeenCalledWith({ displayName: 'Ada', preferences: { locale: 'es', theme: 'system' } });
      expect(api.applyPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ preferencesConfigured: true, preferences: { locale: 'es', theme: 'system' } }),
        '/',
      );
    },
  );

  it('shows an explicitly saved English preference even while viewing the Spanish build', async () => {
    document.documentElement.lang = 'es';
    data.profile.preferencesConfigured = true;
    const fixture = await render();

    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>('#profile-locale')?.value).toBe(
      'en',
    );
  });

  async function render() {
    const fixture = TestBed.createComponent(Account);

    await fixture.whenStable();

    return fixture;
  }

  function button(fixture: ComponentFixture<Account>, text: string) {
    const element: HTMLElement = fixture.nativeElement;
    const found = Array.from(element.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);

    if (!found) throw new Error(`Missing button: ${text}`);

    return found;
  }

  async function fill(fixture: ComponentFixture<Account>, id: string, value: string) {
    const element: HTMLElement = fixture.nativeElement;
    const input = element.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;

    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (input instanceof HTMLSelectElement) input.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
  }

  function confirm(fixture: ComponentFixture<Account>) {
    return vi
      .spyOn(fixture.debugElement.injector.get(SecurityAction), 'run')
      .mockImplementation(async (_context, mutation) => mutation('verified-grant'));
  }

  it('saves display name and preferences through Signal Forms without sensitive confirmation', async () => {
    const fixture = await render();
    const run = confirm(fixture);

    await fill(fixture, 'display-name', 'Updated name');
    await fill(fixture, 'profile-locale', 'es');
    await fill(fixture, 'profile-theme', 'dark');
    button(fixture, 'Save profile').click();
    await fixture.whenStable();
    expect(api.save).toHaveBeenCalledWith({
      displayName: 'Updated name',
      preferences: { locale: 'es', theme: 'dark' },
    });
    expect(run).not.toHaveBeenCalled();
    expect(api.applyPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Updated name', preferences: { locale: 'es', theme: 'dark' } }),
      '/',
    );
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('profile and preferences were saved');
  });

  it('does not mutate when sensitive confirmation is dismissed', async () => {
    const fixture = await render();

    vi.spyOn(fixture.debugElement.injector.get(SecurityAction), 'run').mockResolvedValue(undefined);
    button(fixture, 'Leave workspace immediately').click();
    await fixture.whenStable();
    expect(api.leave).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="status"]')).toBeNull();
  });

  it('leaves the selected workspace with confirmation and explains preservation', async () => {
    const fixture = await render();
    const run = confirm(fixture);
    const element: HTMLElement = fixture.nativeElement;

    expect(element.textContent).toContain('This does not delete your account.');
    button(fixture, 'Leave workspace immediately').click();
    await fixture.whenStable();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'workspace_leave', targetId: 'selected-workspace' }),
      expect.any(Function),
    );
    expect(api.leave).toHaveBeenCalledWith('verified-grant');
    expect(element.querySelector('[role="status"]')?.textContent).toContain('access your other workspaces');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/auth/sign-in');
  });

  it('requires ownership transfer to an existing member before enabling leave', async () => {
    data.isWorkspaceOwner = true;
    data.ownershipCandidates = [{ userId: 'member-2', displayName: 'Second member', email: 'second@example.test' }];
    const fixture = await render();

    confirm(fixture);
    expect(button(fixture, 'Leave workspace immediately').disabled).toBe(true);
    await fill(fixture, 'transfer-member', 'member-2');
    button(fixture, 'Transfer ownership').click();
    await fixture.whenStable();
    expect(api.transfer).toHaveBeenCalledWith('member-2', 'verified-grant');
    expect(button(fixture, 'Leave workspace immediately').disabled).toBe(false);
  });

  it('keeps the old email visible until proof and reports a committed change despite notification failure', async () => {
    api.verifyEmail.mockResolvedValue({ changed: true, notification: 'failed', signInRequired: true });
    auth.ensureSessionLoaded.mockRejectedValue(new Error('refresh failed'));
    const fixture = await render();
    const run = confirm(fixture);

    await fill(fixture, 'new-email', 'new@example.test');
    button(fixture, 'Send a new verification code').click();
    await fixture.whenStable();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'email_change', targetId: 'new@example.test' }),
      expect.any(Function),
    );
    expect(api.requestEmail).toHaveBeenCalledWith('new@example.test', 'verified-grant');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('old@example.test');
    await fill(fixture, 'email-code', '123456');
    button(fixture, 'Verify and change email').click();
    await fixture.whenStable();
    expect(api.verifyEmail).toHaveBeenCalledWith('email-flow', '123456');
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('[role="status"]')?.textContent).toContain(
      'Your email was changed, but the notification',
    );
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows a server ownership rejection without claiming a successful departure', async () => {
    api.leave.mockRejectedValue(new HttpErrorResponse({ status: 409, error: { code: 'ownership_transfer_required' } }));
    const fixture = await render();

    confirm(fixture);
    button(fixture, 'Leave workspace immediately').click();
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Transfer ownership');
    expect(element.querySelector('[role="status"]')).toBeNull();
    expect(element.textContent).toContain(
      'excludes passwords, sessions, authenticator secrets, recovery codes, document contents, and client keys',
    );
  });

  it('does not report a failed save when browser preference application fails after commit', async () => {
    api.applyPreferences.mockImplementation(() => {
      throw new Error('Navigation unavailable');
    });
    const fixture = await render();

    button(fixture, 'Save profile').click();
    await fixture.whenStable();
    expect(api.save).toHaveBeenCalled();
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('[role="status"]')?.textContent).toContain('Your profile was saved, but');
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });
});
