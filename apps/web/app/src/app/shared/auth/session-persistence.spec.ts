import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { BrowserAuth } from './browser-auth';

const user = {
  accountId: 'account-1',
  email: 'returning@example.test',
  emailVerifiedAt: '2026-10-02T00:00:00.000Z',
  id: 'user-1',
  role: 'owner',
};

describe('BrowserAuth session persistence', () => {
  beforeEach(() => {
    document.cookie = 'themis.hasSession=; Path=/; Max-Age=0';
    TestBed.configureTestingModule({ providers: [BrowserAuth, provideHttpClient(), provideHttpClientTesting()] });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function loadSession() {
    const auth = TestBed.inject(BrowserAuth);
    const loading = auth.ensureSessionLoaded();

    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/session')
      .flush({
        data: { authenticated: true, kind: 'full', user },
      });
    await loading;

    return auth;
  }

  it('restores a persisted session without relying on the non-HttpOnly hint cookie', async () => {
    const auth = await loadSession();

    expect(auth.user()).toEqual(user);
    expect(auth.sessionLoaded()).toBe(true);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it.each([0, 503])('keeps verified identity and hints after a resume check fails with %s', async (status) => {
    const auth = await loadSession();

    document.cookie = 'themis.hasSession=1; Path=/';
    const checking = auth.ensureSessionLoaded(true);
    const rejection = expect(checking).rejects.toMatchObject({ status });

    TestBed.inject(HttpTestingController).expectOne('/api/auth/session').flush(null, {
      status,
      statusText: 'Temporarily unavailable',
    });
    await rejection;
    expect(auth.user()).toEqual(user);
    expect(auth.sessionLoaded()).toBe(false);
    expect(document.cookie).toContain('themis.hasSession=1');
    await loadSession();
    expect(auth.sessionLoaded()).toBe(true);
  });

  it('retries an unavailable initial check instead of caching an anonymous result', async () => {
    const auth = TestBed.inject(BrowserAuth);
    const loading = auth.ensureSessionLoaded();

    TestBed.inject(HttpTestingController).expectOne('/api/auth/session').flush(null, {
      status: 503,
      statusText: 'Temporarily unavailable',
    });
    await loading;
    expect(auth.sessionLoaded()).toBe(false);
    expect(auth.user()).toBeNull();
    await loadSession();
    expect(auth.isAuthenticated()).toBe(true);
  });

  it.each(['anonymous', 'restricted'])('clears identity when the server confirms a %s session', async (kind) => {
    const auth = await loadSession();
    const checking = auth.ensureSessionLoaded(true);

    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/session')
      .flush({
        data: { authenticated: false, kind, user: null },
      });
    await checking;
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.sessionLoaded()).toBe(true);
  });

  it('clears verified identity on an explicit unauthorized response', async () => {
    const auth = await loadSession();
    const checking = auth.ensureSessionLoaded(true);

    TestBed.inject(HttpTestingController).expectOne('/api/auth/session').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });
    await checking;
    expect(auth.user()).toBeNull();
    expect(auth.sessionLoaded()).toBe(true);
  });
});
