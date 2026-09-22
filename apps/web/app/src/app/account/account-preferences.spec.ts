import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AccountProfile } from '../shared/auth/account-profile';
import type { Profile } from '../shared/auth/account-profile';
import { Settings } from '../shared/settings';

describe('Account profile preference synchronization', () => {
  const settings = { applyProfilePreferences: vi.fn() };
  const profile: Profile = {
    id: 'user-1',
    displayName: 'Ada',
    email: 'ada@example.test',
    emailVerifiedAt: null,
    createdAt: '',
    updatedAt: '',
    preferences: { locale: 'en', theme: 'system' },
    preferencesConfigured: true,
  };

  beforeEach(() => {
    settings.applyProfilePreferences.mockReset();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Settings, useValue: settings }],
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it.each([false, undefined])(
    'leaves deliberately selected locale and appearance untouched for unset preferences (%s)',
    async (preferencesConfigured) => {
      const api = TestBed.inject(AccountProfile);
      const synchronization = api.synchronizePreferences('user-1', () => '/account');

      TestBed.inject(HttpTestingController)
        .expectOne('/api/account/profile')
        .flush({
          data: { profile: { ...profile, preferencesConfigured } },
        });
      await synchronization;
      expect(settings.applyProfilePreferences).not.toHaveBeenCalled();
    },
  );

  it('fetches once for a signed-in identity and applies to the current route after the response', async () => {
    const api = TestBed.inject(AccountProfile);
    let route = '/dashboard';
    const synchronization = api.synchronizePreferences('user-1', () => route);

    await api.synchronizePreferences('user-1', () => route);
    route = '/account';
    TestBed.inject(HttpTestingController).expectOne('/api/account/profile').flush({ data: { profile } });
    await synchronization;
    expect(settings.applyProfilePreferences).toHaveBeenCalledExactlyOnceWith(
      'user-1',
      profile.preferences,
      '/account',
      'login',
    );
    api.synchronizePreferences('user-1', () => route);
    TestBed.inject(HttpTestingController).expectNone('/api/account/profile');
  });

  it('does not apply a stale response after sign-out or a different identity', async () => {
    const api = TestBed.inject(AccountProfile);
    const synchronization = api.synchronizePreferences('user-1', () => '/account');
    const request = TestBed.inject(HttpTestingController).expectOne('/api/account/profile');

    api.synchronizePreferences(null, () => '/auth/sign-in');
    request.flush({ data: { profile } });
    await synchronization;
    expect(settings.applyProfilePreferences).not.toHaveBeenCalled();
  });

  it('keeps an explicit successful save ahead of a delayed login response', async () => {
    const api = TestBed.inject(AccountProfile);
    const synchronization = api.synchronizePreferences('user-1', () => '/account');
    const request = TestBed.inject(HttpTestingController).expectOne('/api/account/profile');
    const saved: Profile = { ...profile, preferences: { locale: 'es', theme: 'dark' } };

    api.applyPreferences(saved, '/account');
    request.flush({ data: { profile } });
    await synchronization;
    expect(settings.applyProfilePreferences).toHaveBeenCalledExactlyOnceWith(
      'user-1',
      saved.preferences,
      '/account',
      'save',
    );
  });
});
