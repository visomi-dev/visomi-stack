import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { Session } from './session';
import { authInterceptor } from './interceptor';

beforeEach(() =>
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: Session, useValue: { token: vi.fn().mockResolvedValue('synthetic-csrf'), invalidateToken: vi.fn() } },
    ],
  }),
);
afterEach(() => TestBed.inject(HttpTestingController).verify());
it('adds CSRF only to mutations of our own API', async () => {
  const http = TestBed.inject(HttpClient);
  const control = TestBed.inject(HttpTestingController);
  const own = firstValueFrom(http.post('/api/auth/password/sign-in', {}));

  await Promise.resolve();

  const request = control.expectOne('/api/auth/password/sign-in');

  expect(request.request.headers.get('X-CSRF-Token')).toBe('synthetic-csrf');
  expect(request.request.headers.has('Origin')).toBe(false);
  request.flush({});

  await own;

  const external = firstValueFrom(http.post('https://external.example/api/auth', {}));
  const other = control.expectOne('https://external.example/api/auth');

  expect(other.request.headers.has('X-CSRF-Token')).toBe(false);
  other.flush({});

  await external;

  const read = firstValueFrom(http.get('/api/auth/session'));
  const readRequest = control.expectOne('/api/auth/session');

  expect(readRequest.request.headers.has('X-CSRF-Token')).toBe(false);
  readRequest.flush({});

  await read;
});
it('invalidates CSRF on rejection and never replays the mutation', async () => {
  const http = TestBed.inject(HttpClient);
  const control = TestBed.inject(HttpTestingController);
  const session = TestBed.inject(Session);
  const request = firstValueFrom(http.post('/api/auth/logout', {}));
  const failure = expect(request).rejects.toMatchObject({ status: 403 });

  await Promise.resolve();

  control.expectOne('/api/auth/logout').flush({ error: 'csrf_invalid' }, { status: 403, statusText: 'Forbidden' });

  await failure;

  expect(session.invalidateToken).toHaveBeenCalledOnce();
  control.expectNone('/api/auth/logout');
});
