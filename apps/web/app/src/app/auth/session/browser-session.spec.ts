import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TransferState } from '@angular/core';

import { appConfig } from '../../app.config';
import { BrowserRoutePerformance } from '../../observability/browser-route-performance';

import { Session, initialSessionState } from './session';
import { BrowserSession } from './browser-session';
import type { SessionView } from './models';

const anonymous: SessionView = {
  authenticated: false,
  user: null,
  access: 'anonymous',
  method: null,
  nextStep: null,
  csrfToken: 'synthetic-anonymous-csrf',
};
const full: SessionView = {
  authenticated: true,
  user: { id: 'synthetic-user', email: 'demo@example.test', emailVerified: true },
  access: 'full',
  method: 'passkey',
  nextStep: null,
  csrfToken: 'synthetic-rotated-csrf',
};

beforeEach(() =>
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      BrowserSession,
      { provide: Session, useExisting: BrowserSession },
    ],
  }),
);
afterEach(() => TestBed.inject(HttpTestingController).verify());

it('selects the same browser instance through the application Session provider', () => {
  TestBed.configureTestingModule({ providers: [...appConfig.providers, provideHttpClientTesting()] });
  TestBed.overrideProvider(BrowserRoutePerformance, { useValue: {} });

  expect(TestBed.inject(Session)).toBe(TestBed.inject(BrowserSession));
});

it('hydrates the transferred snapshot before HTTP revalidation and removes the consumed state', async () => {
  const { csrfToken: _csrf, ...snapshot } = full;
  const transfer = TestBed.inject(TransferState);

  transfer.set(initialSessionState, { available: true, session: snapshot });
  const session = TestBed.inject(Session);

  expect(session.snapshot()).toEqual(snapshot);
  expect(session.full()).toBe(true);
  expect(transfer.hasKey(initialSessionState)).toBe(false);
  const read = session.load();

  TestBed.inject(HttpTestingController).expectNone('/api/auth/session');

  await read;

  const token = session.token();

  TestBed.inject(HttpTestingController).expectOne('/api/auth/session').flush(full);

  await expect(token).resolves.toBe(full.csrfToken);
});

it('keeps standalone auth unavailable without attempting session or provider requests', async () => {
  TestBed.inject(TransferState).set(initialSessionState, { available: false, session: null });
  const session = TestBed.inject(Session);

  await session.load(true);

  await session.loadProviders();

  expect(session.status()).toBe('unavailable');
  expect(session.full()).toBe(false);
  TestBed.inject(HttpTestingController).expectNone('/api/auth/session');
  TestBed.inject(HttpTestingController).expectNone('/api/auth/providers');
});

it('shares one session request between concurrent consumers', async () => {
  const session = TestBed.inject(Session);
  const http = TestBed.inject(HttpTestingController);
  const first = session.load();
  const second = session.load();

  http.expectOne('/api/auth/session').flush(anonymous);

  await Promise.all([first, second]);

  expect(session.snapshot().access).toBe('anonymous');
  expect(session.status()).toBe('ready');
});
it('ignores a response started before logout', async () => {
  const session = TestBed.inject(Session);
  const http = TestBed.inject(HttpTestingController);
  const request = session.load();

  session.clear();
  http.expectOne('/api/auth/session').flush(full);

  await request;

  expect(session.snapshot().user).toBeNull();
  expect(session.full()).toBe(false);
});
it('preserves a rotated token when an older session read completes', async () => {
  const session = TestBed.inject(Session);
  const http = TestBed.inject(HttpTestingController);
  const request = session.load();

  session.accept(full);
  http.expectOne('/api/auth/session').flush(anonymous);

  await request;

  const result1 = await session.token();

  expect(result1).toBe(full.csrfToken);
  expect(session.full()).toBe(true);
});
it('distinguishes temporary failure from anonymous access and locks private content', async () => {
  const session = TestBed.inject(Session);
  const http = TestBed.inject(HttpTestingController);

  session.accept(full);
  const request = session.load(true);

  http
    .expectOne('/api/auth/session')
    .flush({ error: 'authentication_unavailable' }, { status: 503, statusText: 'Unavailable' });

  await request;

  expect(session.snapshot().user).toEqual(full.user);
  expect(session.status()).toBe('unavailable');
  expect(session.full()).toBe(false);
});
it('obtains a fresh CSRF token after invalidation without retrying a mutation', async () => {
  const session = TestBed.inject(Session);
  const http = TestBed.inject(HttpTestingController);

  session.accept(full);
  session.invalidateToken();
  const token = session.token();

  http.expectOne('/api/auth/session').flush({ ...full, csrfToken: 'synthetic-new-token' });
  const result2 = await token;

  expect(result2).toBe('synthetic-new-token');
});
it('discards an in-flight read before revalidating a change from another tab', async () => {
  const session = TestBed.inject(Session);
  const http = TestBed.inject(HttpTestingController);

  session.accept(full);
  const stale = session.load(true);
  const fresh = session.invalidate();

  expect(session.full()).toBe(false);
  http.expectOne('/api/auth/session').flush(full);

  await stale;

  await vi.waitFor(() => http.expectOne('/api/auth/session').flush(anonymous));

  await fresh;

  expect(session.snapshot().access).toBe('anonymous');
  expect(session.full()).toBe(false);
});

it('rejects an inconsistent server response without manufacturing access', async () => {
  const session = TestBed.inject(Session);
  const http = TestBed.inject(HttpTestingController);
  const operation = session.load();

  http.expectOne('/api/auth/session').flush({ ...anonymous, access: 'full' });

  await operation;

  expect(session.status()).toBe('unavailable');
  expect(session.full()).toBe(false);
});

it('cancels session and provider reads when its injector is destroyed', async () => {
  const session = TestBed.inject(Session);
  const http = TestBed.inject(HttpTestingController);
  const loading = session.load();
  const providers = session.loadProviders();
  const sessionRequest = http.expectOne('/api/auth/session');
  const providerRequest = http.expectOne('/api/auth/providers');

  TestBed.resetTestingModule();

  await Promise.all([loading, providers]);

  expect(sessionRequest.cancelled).toBe(true);
  expect(providerRequest.cancelled).toBe(true);
  expect(session.snapshot().user).toBeNull();
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
});
