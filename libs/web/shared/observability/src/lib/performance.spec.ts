import { LoggerProvider } from '@opentelemetry/sdk-logs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { performanceMeasurements, startBrowserPerformance } from './performance';

const marker = 'SYNTHETIC_PRIVATE_PERFORMANCE_DATA';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OpenTelemetry performance capture policy', () => {
  it('copies only known, bounded numbers and drops attribution, IDs, body, and arbitrary fields', () => {
    expect(
      performanceMeasurements({
        eventName: 'browser.web_vital',
        attributes: {
          'browser.web_vital.name': 'cls',
          'browser.web_vital.value': 0.123456,
          'browser.web_vital.id': marker,
          'url.full': marker,
          attribution: { customer: marker },
        },
      }),
    ).toEqual([{ name: 'cls', value: 0.1235 }]);
    for (const name of ['fcp', 'inp', 'lcp', 'ttfb']) {
      expect(
        performanceMeasurements({
          eventName: 'browser.web_vital',
          attributes: { 'browser.web_vital.name': name, 'browser.web_vital.value': 123.456 },
        }),
      ).toEqual([{ name, value: 123.46 }]);
    }
    for (const value of [-1, Number.NaN, Infinity, 300001, marker, {}, null]) {
      expect(
        performanceMeasurements({
          eventName: 'browser.web_vital',
          attributes: { 'browser.web_vital.name': 'lcp', 'browser.web_vital.value': value },
        }),
      ).toEqual([]);
    }
    expect(performanceMeasurements({ eventName: marker })).toEqual([]);
    expect(performanceMeasurements({ eventName: 'browser.web_vital' })).toEqual([]);
    expect(
      performanceMeasurements({
        eventName: 'browser.web_vital',
        attributes: { 'browser.web_vital.name': marker, 'browser.web_vital.value': 1 },
      }),
    ).toEqual([]);
  });

  it('uses the real navigation instrument and passes only filtered data into the SDK', () => {
    const entry = {
      name: `https://frontend.example.test/customer/${marker}?secret=${marker}`,
      loadEventEnd: 200,
      domInteractive: 100,
      domContentLoadedEventEnd: 150,
      type: marker,
    };

    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([entry as unknown as PerformanceEntry]);
    vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
    vi.stubGlobal('document', { readyState: 'complete' });
    vi.stubGlobal('PerformanceObserver', undefined);
    const original = LoggerProvider.prototype.getLogger;
    const records: unknown[] = [];

    vi.spyOn(LoggerProvider.prototype, 'getLogger').mockImplementation(function (this: LoggerProvider, ...args) {
      const logger = original.apply(this, args);
      const emit = logger.emit.bind(logger);

      vi.spyOn(logger, 'emit').mockImplementation((record) => {
        records.push(record);
        emit(record);
      });

      return logger;
    });
    const send = vi.fn();
    const runtime = startBrowserPerformance(send);

    expect(send).toHaveBeenCalledExactlyOnceWith([
      { name: 'dom_interactive', value: 100 },
      { name: 'dom_content_loaded', value: 150 },
      { name: 'load', value: 200 },
    ]);
    expect(JSON.stringify(records)).not.toContain(marker);
    expect(records[0]).toMatchObject({
      eventName: 'frontend.performance',
      attributes: { dom_interactive: 100, dom_content_loaded: 150, load: 200 },
    });
    runtime.routeTransition('route_completed', 123.456);
    expect(send).toHaveBeenLastCalledWith([{ name: 'route_completed', value: 123.46 }]);
    expect(records.at(-1)).toMatchObject({
      eventName: 'frontend.performance',
      attributes: { route_completed: 123.46 },
    });
    runtime.stop();
    runtime.routeTransition('route_failed', 120);
    window.dispatchEvent(new Event('load'));
    window.dispatchEvent(new Event('pagehide'));
    expect(send).toHaveBeenCalledTimes(2);
  });
});
