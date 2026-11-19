import { setImmediate } from 'node:timers/promises';

import { LoggerProvider } from '@opentelemetry/sdk-logs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserReporter } from './browser';
import type { BrowserConsent } from './consent';
import type { BrowserApplication } from './contract';

const instrumentation = vi.hoisted(() => {
  const constructed = vi.fn();
  const stopped = vi.fn();
  const stopVitals = vi.fn();
  const observeVitals = vi.fn(() => stopVitals);

  return {
    constructed,
    stopped,
    stopVitals,
    observeVitals,
    Instrument: class {
      constructor() {
        constructed();
      }

      setLoggerProvider() {
        /* The real local provider is exercised through route measurements. */
      }

      enable() {
        /* Browser observers are replaced for deterministic transport tests. */
      }

      disable() {
        stopped();
      }
    },
  };
});

vi.mock('@opentelemetry/browser-instrumentation/experimental/navigation-timing', () => ({
  NavigationTimingInstrumentation: instrumentation.Instrument,
}));
vi.mock('./web-vitals', () => ({
  observeWebVitals: instrumentation.observeVitals,
}));

function fixture(allowedAtStartup = true, application: BrowserApplication = 'web-app') {
  const transport = vi.fn().mockResolvedValue(new Response(undefined, { status: 202 }));

  transport.mockResolvedValueOnce(Response.json({ token: 'synthetic-permit', assets: [] }));
  const browser = Object.assign(new EventTarget(), {
    fetch: transport,
    location: new URL('https://frontend.example.test/customer/SYNTHETIC_PRIVATE_DATA'),
  });
  let grant = allowedAtStartup ? 'grant' : undefined;
  let notify: () => void = () => undefined;
  const consent = {
    permit: () => grant,
    subscribe(listener) {
      notify = listener;

      return () => undefined;
    },
    blocked: () => false,
    decided: () => true,
    decide(accept) {
      grant = accept ? 'new-grant' : undefined;
      notify();
    },
    stop: () => undefined,
  } satisfies BrowserConsent;
  const reporter = createBrowserReporter(application, browser as unknown as Window, consent);

  return {
    reporter,
    transport,
    consent,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('performance reporting lifecycle', () => {
  it('keeps the instruments inactive until a new document starts with consent', async () => {
    const f = fixture(false);
    const enabled = await f.reporter.performanceReady;

    expect(enabled).toBe(false);
    f.consent.decide(true);
    f.reporter.routeTransition('route_completed', 10);
    expect(instrumentation.constructed).not.toHaveBeenCalled();
    expect(instrumentation.observeVitals).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    f.reporter.stop();
  });

  it('bounds performance transport separately from errors, refreshes permits and stops with its owner', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const f = fixture(true);

    await f.reporter.performanceReady;

    for (let index = 0; index < 14; index++) {
      f.reporter.routeTransition('route_completed', index);
    }

    await vi.waitFor(() => expect(f.transport).toHaveBeenCalledTimes(13));

    const [path, init] = f.transport.mock.calls[1];

    expect(path).toBe('https://frontend.example.test/telemetry/performance');
    expect(init).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      keepalive: true,
    });
    expect(JSON.parse(init.body)).toEqual({
      application: 'web-app',
      screen: 'unknown',
      measurements: [{ name: 'route_completed', value: 0 }],
    });

    await f.reporter.report('startup_failed');

    expect(f.transport).toHaveBeenCalledTimes(14);
    expect(JSON.stringify(f.transport.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_DATA');
    clock.mockReturnValue(now + 240001);
    f.transport.mockResolvedValueOnce(Response.json({ token: 'refreshed', assets: [] }));
    f.reporter.routeTransition('route_completed', 100);

    await vi.waitFor(() => expect(f.transport).toHaveBeenCalledTimes(16));

    expect(f.transport.mock.calls[15][1].headers['x-browser-telemetry']).toBe('refreshed');
    f.reporter.stop();
    f.reporter.routeTransition('route_failed', 100);
    expect(instrumentation.stopped).toHaveBeenCalledOnce();
    expect(instrumentation.stopVitals).toHaveBeenCalledOnce();
    expect(f.transport).toHaveBeenCalledTimes(16);
  });

  it('drops a performance sample when consent is revoked while the permit refreshes', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const f = fixture(true);
    let complete!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => {
      complete = resolve;
    });

    await f.reporter.performanceReady;

    clock.mockReturnValue(now + 240001);
    f.transport.mockReturnValueOnce(refresh);
    f.reporter.routeTransition('route_completed', 15);
    f.consent.decide(false);
    f.consent.decide(true);
    complete(Response.json({ token: 'refreshed', assets: [] }));

    await setImmediate();

    expect(f.transport.mock.calls.map(([path]) => path)).toEqual(['/telemetry/config', '/telemetry/config']);
    expect(instrumentation.stopVitals).toHaveBeenCalledOnce();
    f.reporter.stop();
  });

  it('contains initialization and transport failures without creating error reports', async () => {
    vi.spyOn(LoggerProvider.prototype, 'getLogger').mockImplementationOnce(() => {
      throw new Error('synthetic-initialization');
    });
    const first = fixture(true);
    const initialized = await first.reporter.performanceReady;

    expect(initialized).toBe(false);
    first.reporter.stop();
    const second = fixture(true);

    await second.reporter.performanceReady;

    second.transport.mockRejectedValue(new Error('synthetic-transport'));
    second.reporter.routeTransition('route_failed', 1);

    await vi.waitFor(() => expect(second.transport).toHaveBeenCalledTimes(2));

    second.reporter.stop();
    expect(second.transport.mock.calls.map(([path]) => path)).toEqual([
      '/telemetry/config',
      'https://frontend.example.test/telemetry/performance',
    ]);
  });

  it('forwards route measurements only through an active Angular performance runtime', async () => {
    const f = fixture(true);

    f.reporter.routeTransition('route_completed', 10);

    await f.reporter.performanceReady;

    expect(f.transport).toHaveBeenCalledOnce();
    f.reporter.routeTransition('route_completed', 10);

    await vi.waitFor(() => expect(f.transport).toHaveBeenCalledTimes(2));

    f.reporter.stop();
    f.reporter.routeTransition('route_failed', 20);
    expect(f.transport).toHaveBeenCalledTimes(2);
    const site = fixture(true, 'web-site');

    await site.reporter.performanceReady;

    site.reporter.routeTransition('route_failed', 20);
    expect(site.transport).toHaveBeenCalledOnce();
    site.reporter.stop();
  });
});
