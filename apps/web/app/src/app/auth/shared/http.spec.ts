import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { Session } from '../session/session';

import { AuthHttp } from './http';

it('aborts a superseded verification before its response can change the session', async () => {
  const accept = vi.fn();
  const cancelled = new Subject<void>();

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      AuthHttp,
      {
        provide: Session,
        useValue: {
          accept,
          cancelled: cancelled.asObservable(),
          operationVersion: () => 0,
          token: async () => 'synthetic-csrf',
        },
      },
    ],
  });
  const api = TestBed.inject(AuthHttp);
  const http = TestBed.inject(HttpTestingController);
  const controller = new AbortController();
  const operation = api.request('POST', '/passkeys/authentication/verify', {}, controller.signal);
  const failure = expect(operation).rejects.toMatchObject({ name: 'AbortError' });

  await Promise.resolve();

  const request = http.expectOne('/api/auth/passkeys/authentication/verify');

  controller.abort();

  await failure;

  expect(request.cancelled).toBe(true);
  expect(accept).not.toHaveBeenCalled();
  http.verify();
});

it('cancels an in-flight security change when logout begins', async () => {
  const accept = vi.fn();
  const cancelled = new Subject<void>();
  let version = 0;

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      AuthHttp,
      {
        provide: Session,
        useValue: {
          accept,
          cancelled: cancelled.asObservable(),
          operationVersion: () => version,
          token: async () => 'synthetic-csrf',
        },
      },
    ],
  });
  const api = TestBed.inject(AuthHttp);
  const http = TestBed.inject(HttpTestingController);
  const operation = api.request('POST', '/password/change', { password: 'synthetic private password' });
  const failure = expect(operation).rejects.toMatchObject({ name: 'AbortError' });

  await Promise.resolve();

  const request = http.expectOne('/api/auth/password/change');

  version++;
  cancelled.next();

  await failure;

  expect(request.cancelled).toBe(true);
  expect(accept).not.toHaveBeenCalled();
  http.verify();
});
