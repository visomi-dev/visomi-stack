import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserErrors } from './browser-errors';

const marker = 'SYNTHETIC_PRIVATE_ANGULAR_ERROR';

afterEach(() => TestBed.resetTestingModule());

function fixture(platform = 'browser') {
  const host = new EventTarget();
  const fetch = vi.fn().mockResolvedValue(new Response(undefined, { status: 202 }));

  fetch.mockResolvedValueOnce(Response.json({ token: 'synthetic-token', assets: [] }));
  const browser = Object.assign(host, { fetch, location: new URL('https://frontend.example.test/app/en/ui/') });
  const remove = vi.spyOn(browser, 'removeEventListener');

  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: DOCUMENT, useValue: { defaultView: browser } },
    ],
  });

  return { errors: TestBed.inject(BrowserErrors), fetch, remove };
}

describe('Angular browser error adapter', () => {
  it('sanitizes framework and API failures, preserves server-issued correlation, and cleans up', async () => {
    const f = fixture();

    f.errors.handleError(new TypeError(marker));
    f.errors.requestFailed(
      '/api/session',
      new HttpErrorResponse({
        status: 503,
        headers: new HttpHeaders({ 'x-telemetry-context': 'synthetic-server-signed-context' }),
        error: { customer: marker },
      }),
    );

    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(3));

    const reports = f.fetch.mock.calls.slice(1).map(([, options]) => JSON.parse(options.body));

    expect(reports).toEqual([
      { application: 'web-app', code: 'unhandled_exception', kind: 'TypeError', screen: 'ui' },
      {
        application: 'web-app',
        code: 'request_failed',
        kind: 'unknown',
        screen: 'ui',
        correlation: 'synthetic-server-signed-context',
      },
    ]);
    expect(JSON.stringify(reports)).not.toContain(marker);
    TestBed.resetTestingModule();
    expect(f.remove).toHaveBeenCalledTimes(2);
  });

  it('ignores non-HTTP errors, external requests, and expected client errors', async () => {
    const f = fixture();

    f.errors.requestFailed('/api/session', new Error(marker));
    f.errors.requestFailed('/api/session', new HttpErrorResponse({ status: 401 }));
    f.errors.requestFailed('https://external.example.test/api/', new HttpErrorResponse({ status: 503 }));
    f.errors.requestFailed('/en/', new HttpErrorResponse({ status: 503 }));
    f.errors.requestFailed('http://[', new HttpErrorResponse({ status: 503 }));

    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledOnce());
  });

  it('does not install browser telemetry during SSR', () => {
    const f = fixture('server');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    f.errors.handleError(new Error(marker));
    f.errors.requestFailed('/api/session', new HttpErrorResponse({ status: 503 }));
    expect(f.fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('{"event":"app.render_failed"}');
    log.mockRestore();
  });
});
