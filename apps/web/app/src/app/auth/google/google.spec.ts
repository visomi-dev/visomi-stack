import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CSP_NONCE } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { AuthHttp } from '../shared/http';
import { Session } from '../session/session';

import { Google } from './google';
import { GoogleButton } from './google-button';

const session = {
  authenticated: true,
  user: { id: 'synthetic', email: 'demo@example.test', emailVerified: true },
  access: 'full',
  method: 'google',
  nextStep: null,
  csrfToken: 'synthetic-rotated',
};
let callback: (result: { credential: string }) => void;
const initialize = vi.fn((options: { callback: typeof callback }) => {
  callback = options.callback;
});
const renderButton = vi.fn();
const disconnect = vi.fn();
let cancellation: AbortController;

beforeEach(() => {
  cancellation = new AbortController();
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(320);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = disconnect;

      observe(): void {
        /* The browser suite exercises resize delivery. */
      }
    },
  );

  vi.stubGlobal('google', { accounts: { id: { initialize, renderButton, cancel: vi.fn() } } });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      AuthHttp,
      Google,
      {
        provide: Session,
        useValue: {
          accept: vi.fn(),
          load: vi.fn().mockResolvedValue(undefined),
          token: vi.fn().mockResolvedValue('synthetic-csrf'),
          operationVersion: () => 0,
          cancellation: () => cancellation.signal,
        },
      },
    ],
  });
});

afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('uses the server nonce and submits a Google credential only once', async () => {
  const api = TestBed.inject(Google);
  const http = TestBed.inject(HttpTestingController);
  const complete = vi.fn();
  const failed = vi.fn();
  const processing = vi.fn();
  let allowed = false;
  const ready = api.button(document.createElement('div'), 'login', complete, failed, () => allowed, processing);

  await Promise.resolve();

  const start = http.expectOne('/api/auth/google/start');

  expect(start.request.body).toEqual({ intent: 'login' });
  start.flush({
    flowId: 'synthetic-flow',
    expiresAt: '2099-01-01T00:00:00Z',
    clientId: 'synthetic-client',
    nonce: 'synthetic-nonce',
  });

  await ready;

  TestBed.tick();

  expect(initialize).toHaveBeenCalledWith(
    expect.objectContaining({ nonce: 'synthetic-nonce', client_id: 'synthetic-client', auto_select: false }),
  );

  expect(renderButton).toHaveBeenCalledOnce();
  callback({ credential: 'synthetic-blocked' });
  http.expectNone('/api/auth/google/complete');
  allowed = true;
  callback({ credential: 'synthetic-id-token' });
  callback({ credential: 'synthetic-duplicate' });

  await Promise.resolve();

  const verification = http.expectOne('/api/auth/google/complete');

  expect(verification.request.body).toEqual({ flowId: 'synthetic-flow', idToken: 'synthetic-id-token' });
  verification.flush(session);

  await vi.waitFor(() => expect(complete).toHaveBeenCalledExactlyOnceWith(session));

  expect(failed).not.toHaveBeenCalled();
  expect(processing.mock.calls).toEqual([[true], [false]]);
});

it('releases reauthentication and permits a new Google attempt after session invalidation', async () => {
  const api = TestBed.inject(Google);
  const http = TestBed.inject(HttpTestingController);
  const complete = vi.fn();
  const failed = vi.fn();
  const processing = vi.fn();
  const element = document.createElement('div');
  const render = async (flowId: string) => {
    const ready = api.button(element, 'reauth', complete, failed, undefined, processing);

    await Promise.resolve();

    http.expectOne('/api/auth/google/start').flush({
      flowId,
      clientId: 'synthetic-client',
      nonce: 'synthetic-nonce',
    });

    await ready;

    TestBed.tick();
  };

  await render('first');

  const staleCallback = callback;

  staleCallback({ credential: 'synthetic-old' });

  await Promise.resolve();

  const first = http.expectOne('/api/auth/google/complete');

  const previous = cancellation;

  cancellation = new AbortController();
  previous.abort();

  expect(first.cancelled).toBe(true);
  expect(processing.mock.calls).toEqual([[true], [false]]);
  expect(failed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'AbortError' }));

  await render('second');

  staleCallback({ credential: 'synthetic-old' });
  callback({ credential: 'synthetic-new' });

  await Promise.resolve();

  const second = http.expectOne('/api/auth/google/complete');

  expect(second.request.body).toEqual({ flowId: 'second', idToken: 'synthetic-new' });
  second.flush(session);

  await vi.waitFor(() => expect(complete).toHaveBeenCalledExactlyOnceWith(session));

  expect(processing.mock.calls).toEqual([[true], [false], [true], [false]]);
  expect(failed).toHaveBeenCalledOnce();
});

it('does not complete a Google callback after its owning view is destroyed', async () => {
  const api = TestBed.inject(Google);
  const http = TestBed.inject(HttpTestingController);
  const complete = vi.fn();
  const failed = vi.fn();
  const ready = api.button(document.createElement('div'), 'reauth', complete, failed);

  await Promise.resolve();

  http
    .expectOne('/api/auth/google/start')
    .flush({ flowId: 'synthetic-flow', clientId: 'synthetic-client', nonce: 'synthetic-nonce' });

  await ready;

  TestBed.tick();

  const destroy = TestBed.inject(HttpClient);

  expect(destroy).toBeDefined();
  TestBed.resetTestingModule();
  expect(disconnect).toHaveBeenCalledOnce();
  callback({ credential: 'synthetic-id-token' });
  expect(complete).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
  http.expectNone('/api/auth/google/complete');
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
});

it('loads the localized provider script with the Angular CSP nonce', async () => {
  vi.stubGlobal('google', undefined);
  TestBed.overrideProvider(CSP_NONCE, { useValue: 'synthetic-angular-nonce' });
  const api = TestBed.inject(Google);
  const http = TestBed.inject(HttpTestingController);
  const ready = api.button(document.createElement('div'), 'login', vi.fn(), vi.fn());

  await Promise.resolve();

  http.expectOne('/api/auth/google/start').flush({
    flowId: 'synthetic-flow',
    clientId: 'synthetic-client',
    nonce: 'synthetic-provider-nonce',
  });

  await vi.waitFor(() =>
    expect(document.querySelector('script[src="https://accounts.google.com/gsi/client?hl=en"]')).not.toBeNull(),
  );

  const script = document.querySelector<HTMLScriptElement>(
    'script[src="https://accounts.google.com/gsi/client?hl=en"]',
  )!;

  try {
    expect(script.nonce).toBe('synthetic-angular-nonce');
    vi.stubGlobal('google', { accounts: { id: { initialize, renderButton, cancel: vi.fn() } } });
    script.dispatchEvent(new Event('load'));

    await ready;

    TestBed.tick();

    expect(renderButton).toHaveBeenCalledOnce();
  } finally {
    script.remove();
  }
});

it('starts a fresh Google flow after linking and can link a second account without remounting', async () => {
  const fixture = TestBed.createComponent(GoogleButton);
  const http = TestBed.inject(HttpTestingController);
  const completed = vi.fn();

  fixture.componentRef.setInput('intent', 'link');
  fixture.componentInstance.completed.subscribe(completed);
  fixture.detectChanges();

  await Promise.resolve();

  http.expectOne('/api/auth/google/start').flush({
    flowId: 'first-link',
    clientId: 'synthetic-client',
    nonce: 'first-nonce',
  });

  await fixture.whenStable();

  await vi.waitFor(() => expect(renderButton).toHaveBeenCalledOnce());

  const firstCallback = callback;

  firstCallback({ credential: 'first-account' });

  const first = await vi.waitFor(() => http.expectOne('/api/auth/google/complete'));

  first.flush(session);

  const next = await vi.waitFor(() => http.expectOne('/api/auth/google/start'));

  expect(completed).toHaveBeenCalledExactlyOnceWith(session);

  expect(next.request.body).toEqual({ intent: 'link' });
  next.flush({ flowId: 'second-link', clientId: 'synthetic-client', nonce: 'second-nonce' });

  await fixture.whenStable();

  await vi.waitFor(() =>
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ nonce: 'second-nonce' })),
  );

  firstCallback({ credential: 'stale-first-account' });
  callback({ credential: 'second-account' });

  const second = await vi.waitFor(() => http.expectOne('/api/auth/google/complete'));

  expect(second.request.body).toEqual({ flowId: 'second-link', idToken: 'second-account' });
  second.flush(session);

  const third = await vi.waitFor(() => http.expectOne('/api/auth/google/start'));

  expect(completed).toHaveBeenCalledTimes(2);
  third.flush({
    flowId: 'third-link',
    clientId: 'synthetic-client',
    nonce: 'third-nonce',
  });

  await fixture.whenStable();
});
