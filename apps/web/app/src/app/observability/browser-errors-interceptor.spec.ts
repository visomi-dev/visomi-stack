import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserErrorsInterceptor } from './browser-errors-interceptor';
import { BROWSER_ERROR_REPORTER, BrowserTelemetry } from './browser-telemetry';

import { createBrowserReporter } from '@visomi-stack/web-shared-observability';

const marker = 'SYNTHETIC_PRIVATE_HTTP_DATA';

afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
  TestBed.resetTestingModule();
});

function fixture(platform = 'browser') {
  const fetch = vi.fn().mockResolvedValue(new Response(undefined, { status: 202 }));

  fetch.mockResolvedValueOnce(Response.json({ token: 'synthetic-token', assets: [] }));
  const browser = Object.assign(new EventTarget(), {
    fetch,
    location: new URL('https://frontend.example.test/app/en/'),
  });
  const reporter =
    platform === 'browser'
      ? createBrowserReporter('web-app', browser as unknown as Window, { globalErrors: false })
      : undefined;

  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: DOCUMENT, useValue: { defaultView: browser } },
      ...(reporter ? [{ provide: BROWSER_ERROR_REPORTER, useValue: reporter }] : []),
      provideHttpClient(withInterceptors([browserErrorsInterceptor])),
      provideHttpClientTesting(),
    ],
  });

  return {
    fetch,
    http: TestBed.inject(HttpClient),
    controller: TestBed.inject(HttpTestingController),
    telemetry: TestBed.inject(BrowserTelemetry),
  };
}

describe('browserErrorsInterceptor', () => {
  it('reports API 5xx failures with server correlation and propagates the original error', async () => {
    const f = fixture();
    const received = vi.fn();

    f.http
      .post('/api/session', { synthetic: marker }, { headers: { 'x-synthetic': marker } })
      .subscribe({ error: received });
    const request = f.controller.expectOne('/api/session');

    expect(request.request.body).toEqual({ synthetic: marker });
    expect(request.request.headers.get('x-synthetic')).toBe(marker);
    request.flush(
      { customer: marker },
      {
        status: 503,
        statusText: 'Synthetic failure',
        headers: { 'x-telemetry-context': 'synthetic-server-signed-context' },
      },
    );
    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0][0]).toBeInstanceOf(HttpErrorResponse);
    expect(received.mock.calls[0][0].error).toEqual({ customer: marker });

    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));

    const payload = JSON.parse(f.fetch.mock.calls[1][1].body);

    expect(payload).toEqual({
      application: 'web-app',
      code: 'request_failed',
      kind: 'unknown',
      screen: 'home',
      correlation: 'synthetic-server-signed-context',
    });
    expect(JSON.stringify(payload)).not.toContain(marker);
  });

  it('reports network failures without sending the URL or error event', async () => {
    const f = fixture();
    const received = vi.fn();
    const url = '/api/synthetic?private=' + marker;
    const event = new ProgressEvent('error');

    f.http.get(url).subscribe({ error: received });
    f.controller.expectOne(url).error(event);
    expect(received.mock.calls[0][0].error).toBe(event);
    expect(received.mock.calls[0][0].status).toBe(0);

    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2));

    expect(JSON.parse(f.fetch.mock.calls[1][1].body)).toEqual({
      application: 'web-app',
      code: 'request_failed',
      kind: 'unknown',
      screen: 'home',
    });
  });

  it('ignores successful, client, external, non-API, and malformed URL responses', async () => {
    const f = fixture();
    const report = vi.spyOn(f.telemetry, 'report');

    f.http.get('/api/success').subscribe();
    f.controller.expectOne('/api/success').flush({ synthetic: true });
    for (const [url, status] of [
      ['/api/session', 401],
      ['https://external.example.test/api/', 503],
      ['/en/', 503],
      ['http://[', 503],
    ] as const) {
      f.http.get(url).subscribe({ error: () => undefined });
      f.controller.expectOne(url).flush(null, { status, statusText: 'Synthetic failure' });
    }
    const original = new Error(marker);
    const failed = TestBed.runInInjectionContext(() =>
      browserErrorsInterceptor(new HttpRequest('GET', '/api/synthetic'), () => throwError(() => original)),
    );

    await expect(firstValueFrom(failed)).rejects.toBe(original);

    expect(report).not.toHaveBeenCalled();
  });

  it('does not report HTTP errors during SSR', () => {
    const f = fixture('server');
    const report = vi.spyOn(f.telemetry, 'report');
    const received = vi.fn();

    f.http.get('/api/session').subscribe({ error: received });
    f.controller.expectOne('/api/session').flush(null, { status: 503, statusText: 'Synthetic failure' });
    expect(received).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
