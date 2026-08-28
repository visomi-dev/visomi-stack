import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { Auth } from './auth';
import { AUTH_REQUEST_CONTEXT } from './auth-request-context.token';
import { BrowserAuth } from './browser-auth';
import { ServerAuth } from './server-auth';

describe('BrowserAuth', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.cookie = 'themis.hasSession=; Path=/; Max-Age=0';

    TestBed.configureTestingModule({
      providers: [
        BrowserAuth,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useExisting: BrowserAuth },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('stores the pending challenge after credential submission', async () => {
    const auth = TestBed.inject(Auth);
    const http = TestBed.inject(HttpTestingController);

    const submitPromise = auth.signUp({
      email: 'engineer@themis.dev',
      password: 'S3cureAuth!',
    });

    http.expectOne('/api/auth/sign-up').flush({
      data: {
        challengeId: 'challenge-1',
        email: 'engineer@themis.dev',
        expiresAt: '2026-01-01T00:00:00.000Z',
        purpose: 'sign_up',
      },
    });

    await submitPromise;

    expect(auth.pendingChallenge()?.challengeId).toBe('challenge-1');
    expect(sessionStorage.getItem('themis.pendingChallenge')).toContain('challenge-1');
  });

  it('skips the session request when the hasSession cookie is absent', async () => {
    const auth = TestBed.inject(Auth);

    await auth.ensureSessionLoaded();

    TestBed.inject(HttpTestingController).expectNone('/api/auth/session');
    expect(auth.sessionLoaded()).toBe(true);
    expect(auth.user()).toBeNull();
  });

  it('fetches the session when the hasSession cookie is present', async () => {
    document.cookie = 'themis.hasSession=1; Path=/';

    const auth = TestBed.inject(Auth);
    const http = TestBed.inject(HttpTestingController);

    const promise = auth.ensureSessionLoaded();

    const request = http.expectOne('/api/auth/session');

    request.flush({
      data: {
        authenticated: true,
        user: {
          accountId: 'account-1',
          email: 'engineer@themis.dev',
          emailVerifiedAt: null,
          id: 'user-1',
          role: 'owner',
        },
      },
    });

    await promise;

    expect(auth.user()?.id).toBe('user-1');
  });

  it('clears the hasSession cookie when the session is gone', async () => {
    document.cookie = 'themis.hasSession=1; Path=/';

    const auth = TestBed.inject(Auth);
    const http = TestBed.inject(HttpTestingController);

    const promise = auth.ensureSessionLoaded();

    http.expectOne('/api/auth/session').flush({
      data: { authenticated: false, user: null },
    });

    await promise;

    expect(document.cookie).not.toContain('themis.hasSession=1');
  });
});

describe('ServerAuth', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ServerAuth,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useExisting: ServerAuth },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('does not fetch the session without a session cookie', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ServerAuth,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useExisting: ServerAuth },
      ],
    });

    const auth = TestBed.inject(Auth);

    await auth.ensureSessionLoaded();

    TestBed.inject(HttpTestingController).expectNone('/api/auth/session');
    expect(auth.sessionLoaded()).toBe(true);
    expect(auth.user()).toBeNull();
  });

  it('uses the user from the request context when provided', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ServerAuth,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Auth, useExisting: ServerAuth },
        {
          provide: AUTH_REQUEST_CONTEXT,
          useValue: {
            user: {
              accountId: 'account-1',
              email: 'engineer@themis.dev',
              emailVerifiedAt: null,
              id: 'user-1',
              role: 'owner',
            },
          },
        },
      ],
    });

    const auth = TestBed.inject(Auth);

    await auth.ensureSessionLoaded();

    TestBed.inject(HttpTestingController).expectNone('/api/auth/session');
    expect(auth.user()?.id).toBe('user-1');
  });
});
