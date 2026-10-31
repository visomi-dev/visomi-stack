import { type ApplicationConfig, type ValueProvider } from '@angular/core';
import { afterEach, expect, it, vi } from 'vitest';

import { BROWSER_ERROR_REPORTER } from './app/observability/browser-telemetry';

import { type createBrowserReporter } from '@visomi-stack/web-shared-observability';

const { bootstrap } = vi.hoisted(() => ({ bootstrap: vi.fn() }));

vi.mock('@angular/platform-browser', async (original) => {
  const module = await original<typeof import('@angular/platform-browser')>();

  return { ...module, bootstrapApplication: bootstrap };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('shares the startup reporter with Angular and waits for an existing report before stopping', async () => {
  const error = new TypeError('SYNTHETIC_PRIVATE_STARTUP_ERROR');
  const fetch = vi.fn().mockResolvedValue(new Response(undefined, { status: 202 }));
  let resolveConfiguration!: (response: Response) => void;

  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveConfiguration = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const stop = vi.fn();

  bootstrap.mockImplementation((_root: unknown, config: ApplicationConfig) => {
    const provider = config.providers.find(
      (entry) => (entry as ValueProvider).provide === BROWSER_ERROR_REPORTER,
    ) as ValueProvider;
    const reporter = provider.useValue as ReturnType<typeof createBrowserReporter>;
    const originalStop = reporter.stop;

    vi.spyOn(reporter, 'stop').mockImplementation(() => {
      originalStop();
      stop();
    });
    // Angular may deliver a bootstrap failure to ErrorHandler before rejecting bootstrap.
    void reporter.report('unhandled_exception', error);

    return Promise.reject(error);
  });

  await import('./main');

  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

  expect(stop).not.toHaveBeenCalled();
  resolveConfiguration(Response.json({ token: 'synthetic-token', assets: [] }));

  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());

  expect(bootstrap).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
    application: 'web-app',
    code: 'unhandled_exception',
    kind: 'TypeError',
  });
  expect(JSON.stringify(fetch.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_STARTUP_ERROR');
});
