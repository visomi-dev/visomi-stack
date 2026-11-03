import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CSP_NONCE } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { AuthHttp } from '../shared/http';
import { Session } from '../session/session';

import { Google } from './google';

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
let cancelled: Subject<void>;

beforeEach(() => {
  cancelled = new Subject<void>();
  vi.stubGlobal('google', { accounts: { id: { initialize, renderButton, cancel: vi.fn() } } });
  TestBed.configureTestingModule({
    providers: [
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
          cancelled,
        },
      },
    ],
  });
});
afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
  vi.unstubAllGlobals();
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
  };

  await render('first');

  const staleCallback = callback;

  staleCallback({ credential: 'synthetic-old' });

  await Promise.resolve();

  const first = http.expectOne('/api/auth/google/complete');

  cancelled.next();

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

  const destroy = TestBed.inject(HttpClient);

  expect(destroy).toBeDefined();
  TestBed.resetTestingModule();
  callback({ credential: 'synthetic-id-token' });
  expect(complete).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
  http.expectNone('/api/auth/google/complete');
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
});

it('loads the provider script with the Angular CSP nonce', async () => {
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
    expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).not.toBeNull(),
  );

  const script = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')!;

  try {
    expect(script.nonce).toBe('synthetic-angular-nonce');
    vi.stubGlobal('google', { accounts: { id: { initialize, renderButton, cancel: vi.fn() } } });
    script.dispatchEvent(new Event('load'));

    await ready;

    expect(renderButton).toHaveBeenCalledOnce();
  } finally {
    script.remove();
  }
});
