import { LoggerProvider } from '@opentelemetry/sdk-logs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserReporter } from './browser';
import type { BrowserApplication } from './contract';

const instrumentation = vi.hoisted(() => {
  const constructed = vi.fn();
  const stopped = vi.fn();

  return {
    constructed,
    stopped,
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
vi.mock('@opentelemetry/browser-instrumentation/experimental/web-vitals', () => ({
  WebVitalsInstrumentation: instrumentation.Instrument,
}));

function fixture(enabled: boolean, application: BrowserApplication = 'web-app') {
  const transport = vi.fn().mockResolvedValue(new Response(undefined, { status: 202 }));

  transport.mockResolvedValueOnce(Response.json({ token: 'synthetic-permit', assets: [], performance: enabled }));
  const browser = Object.assign(new EventTarget(), {
    fetch: transport,
    location: new URL('https://frontend.example.test/customer/SYNTHETIC_PRIVATE_DATA'),
  });
  const reporter = createBrowserReporter(application, browser as unknown as Window);

  return { reporter, transport };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('performance reporting lifecycle', () => {
  it('keeps the instruments inactive unless the server explicitly enables performance capture', async () => {
    const f = fixture(false);
    const enabled = await f.reporter.performanceReady;

    expect(enabled).toBe(false);
    expect(instrumentation.constructed).not.toHaveBeenCalled();
    expect(f.transport).toHaveBeenCalledOnce();
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

    expect(path).toBe('/telemetry/performance');
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
    f.transport.mockResolvedValueOnce(Response.json({ token: 'refreshed', assets: [], performance: true }));
    f.reporter.routeTransition('route_completed', 100);

    await vi.waitFor(() => expect(f.transport).toHaveBeenCalledTimes(16));

    expect(f.transport.mock.calls[15][1].headers['x-browser-telemetry']).toBe('refreshed');
    f.reporter.stop();
    f.reporter.routeTransition('route_failed', 100);
    expect(instrumentation.stopped).toHaveBeenCalledTimes(2);
    expect(f.transport).toHaveBeenCalledTimes(16);
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
    expect(second.transport.mock.calls.map(([path]) => path)).toEqual(['/telemetry/config', '/telemetry/performance']);
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
