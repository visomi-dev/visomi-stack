import { HttpHeaders, HttpRequest, type HttpInterceptorFn } from '@angular/common/http';
import { PLATFORM_ID, REQUEST } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { httpInterceptor } from './http-interceptor';

describe('httpInterceptor', () => {
  const runInterceptor: HttpInterceptorFn = (req, next) =>
    TestBed.runInInjectionContext(() => httpInterceptor(req, next));

  function buildRequest(url: string, headers: Record<string, string> = {}): HttpRequest<unknown> {
    return new HttpRequest('GET', url, null, { headers: new HttpHeaders(headers) });
  }

  it('passes the request through on the browser', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });

    const next = vi.fn((req: HttpRequest<unknown>) => req);
    const request = buildRequest('/api/projects');

    const result = runInterceptor(request, next);

    expect(next).toHaveBeenCalledWith(request);
    expect(result).toBe(request);
  });

  it('rewrites the request URL and forwards the cookie on the server', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        {
          provide: REQUEST,
          useValue: new Request('http://localhost:8080/app/dashboard', { headers: { cookie: 'sid=abc' } }),
        },
      ],
    });

    const next = vi.fn((req: HttpRequest<unknown>) => req);
    const request = buildRequest('/api/projects');

    runInterceptor(request, next);

    expect(next).toHaveBeenCalledTimes(1);

    const cloned = next.mock.calls[0]?.[0] as HttpRequest<unknown>;

    expect(cloned.url).toBe('http://localhost:8080/api/projects');
    expect(cloned.headers.get('cookie')).toBe('sid=abc');
  });

  it('passes non-api URLs through unchanged on the server', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        {
          provide: REQUEST,
          useValue: new Request('http://localhost:8080/app/dashboard', { headers: { cookie: 'sid=abc' } }),
        },
      ],
    });

    const next = vi.fn((req: HttpRequest<unknown>) => req);
    const request = buildRequest('https://avatars.example.com/user.png');

    const result = runInterceptor(request, next);

    expect(next).toHaveBeenCalledWith(request);
    expect(result).toBe(request);
  });

  it('does not inject an empty cookie header on the server', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: REQUEST, useValue: new Request('http://localhost:8080/app/dashboard') },
      ],
    });

    const next = vi.fn((req: HttpRequest<unknown>) => req);
    const request = buildRequest('/api/projects');

    runInterceptor(request, next);

    const cloned = next.mock.calls[0]?.[0] as HttpRequest<unknown>;

    expect(cloned.headers.has('cookie')).toBe(false);
  });
});
