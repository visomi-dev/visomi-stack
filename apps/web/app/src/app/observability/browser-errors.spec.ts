import { DOCUMENT } from '@angular/common';
import { ErrorHandler, PLATFORM_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserErrors } from './browser-errors';
import { BROWSER_ERROR_REPORTER, BrowserTelemetry } from './browser-telemetry';

import { createBrowserReporter } from '@visomi-stack/web-shared-observability';

const marker = 'SYNTHETIC_PRIVATE_ANGULAR_ERROR';

afterEach(() => {
  vi.unstubAllGlobals();
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('Angular browser error handler', () => {
  it('delegates to the telemetry service and keeps development diagnostics local', () => {
    const telemetry = { report: vi.fn() };

    TestBed.configureTestingModule({ providers: [{ provide: BrowserTelemetry, useValue: telemetry }] });
    const errors = TestBed.inject(BrowserErrors);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new TypeError(marker);

    errors.handleError(error);
    expect(telemetry.report).toHaveBeenCalledExactlyOnceWith('unhandled_exception', error);
    expect(log).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('does not print raw errors in production', () => {
    const telemetry = { report: vi.fn() };

    TestBed.configureTestingModule({ providers: [{ provide: BrowserTelemetry, useValue: telemetry }] });
    const errors = TestBed.inject(BrowserErrors);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.stubGlobal('ngDevMode', false);
    errors.handleError(new Error(marker));
    expect(log).not.toHaveBeenCalled();
    expect(telemetry.report).toHaveBeenCalledOnce();
  });

  it('uses Angular global listeners, filters payloads, and removes listeners on destruction', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(undefined, { status: 202 }));

    fetch.mockResolvedValueOnce(Response.json({ token: 'synthetic-token', assets: [] }));
    const browser = Object.assign(new EventTarget(), {
      fetch,
      location: new URL('https://frontend.example.test/app/en/'),
    });
    const add = vi.spyOn(browser, 'addEventListener');
    const remove = vi.spyOn(browser, 'removeEventListener');
    const reporter = createBrowserReporter('web-app', browser as unknown as Window, { globalErrors: false });
    const stop = vi.spyOn(reporter, 'stop');

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      rethrowApplicationErrors: false,
      providers: [
        { provide: DOCUMENT, useValue: { defaultView: browser } },
        { provide: BROWSER_ERROR_REPORTER, useValue: reporter },
        { provide: ErrorHandler, useExisting: BrowserErrors },
        provideBrowserGlobalErrorListeners(),
      ],
    });
    TestBed.inject(ErrorHandler);
    expect(add.mock.calls.map(([type]) => type).sort()).toEqual(['error', 'unhandledrejection']);
    browser.dispatchEvent(Object.assign(new Event('error'), { error: new TypeError(marker) }));
    browser.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: { customer: marker } }));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    const reports = fetch.mock.calls.slice(1).map(([, options]) => JSON.parse(options.body));

    expect(reports).toEqual([
      { application: 'web-app', code: 'unhandled_exception', kind: 'TypeError', screen: 'home' },
      { application: 'web-app', code: 'unhandled_exception', kind: 'unknown', screen: 'home' },
    ]);
    expect(JSON.stringify(reports)).not.toContain(marker);
    TestBed.resetTestingModule();
    expect(stop).toHaveBeenCalledOnce();
    expect(remove.mock.calls.map(([type]) => type).sort()).toEqual(['error', 'unhandledrejection']);
    browser.dispatchEvent(Object.assign(new Event('error'), { error: new RangeError(marker) }));

    await reporter.report('startup_failed', new Error(marker));

    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps SSR diagnostics controlled and never creates a browser reporter', () => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    const fetch = vi.spyOn(window, 'fetch');
    const errors = TestBed.inject(BrowserErrors);
    const telemetry = vi.spyOn(TestBed.inject(BrowserTelemetry), 'report');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    errors.handleError(new Error(marker));
    expect(fetch).not.toHaveBeenCalled();
    expect(telemetry).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith('{"event":"app.render_failed"}');
  });
});
