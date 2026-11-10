import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserErrors } from './browser-errors';
import { BrowserRoutePerformance } from './browser-route-performance';
import { BrowserTelemetry, BROWSER_ERROR_REPORTER } from './browser-telemetry';
import { ServerErrors } from './server-errors';

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Angular server error handler', () => {
  it.each([true, false])('keeps SSR diagnostics controlled with development mode=%s', (development) => {
    TestBed.configureTestingModule({
      providers: [ServerErrors, { provide: ErrorHandler, useExisting: ServerErrors }],
    });
    const errors = TestBed.inject(ErrorHandler);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetch = vi.spyOn(window, 'fetch');
    const privateError = new Error('SYNTHETIC_PRIVATE_SSR_ERROR');

    vi.stubGlobal('ngDevMode', development);
    errors.handleError(privateError);
    expect(errors).toBe(TestBed.inject(ServerErrors));
    expect(log).toHaveBeenCalledExactlyOnceWith('{"event":"app.render_failed"}');
    expect(fetch).not.toHaveBeenCalled();
    expect(TestBed.inject(BrowserErrors, null)).toBeNull();
    expect(TestBed.inject(BrowserTelemetry, null)).toBeNull();
    expect(TestBed.inject(BrowserRoutePerformance, null)).toBeNull();
    expect(TestBed.inject(BROWSER_ERROR_REPORTER, null)).toBeNull();
  });

  it('does not inspect or serialize the supplied error', () => {
    TestBed.configureTestingModule({ providers: [ServerErrors] });
    const read = vi.fn(() => {
      throw new Error('SYNTHETIC_PRIVATE_ERROR_ACCESS');
    });
    const privateError = Object.defineProperties(
      {},
      {
        message: { get: read },
        stack: { get: read },
        toJSON: { get: read },
      },
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => TestBed.inject(ServerErrors).handleError(privateError)).not.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith('{"event":"app.render_failed"}');
  });
});
