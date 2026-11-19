import { afterEach, expect, it, vi } from 'vitest';

import { observeWebVitals } from './web-vitals';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('reads only approved timing aggregates and disconnects every observer when permission ends', () => {
  const observers = new Map<string, Observer>();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const browser = new EventTarget();
  const marker = 'SYNTHETIC_PRIVATE_TIMING_ENTRY';

  class Observer {
    static supportedEntryTypes = ['paint', 'largest-contentful-paint', 'layout-shift', 'event', 'first-input'];

    readonly disconnect = vi.fn();
    readonly takeRecords = vi.fn((): PerformanceEntry[] => []);

    constructor(readonly callback: (list: Pick<PerformanceObserverEntryList, 'getEntries'>) => void) {}

    observe({ type }: { type: string }): void {
      observers.set(type, this);
    }
  }

  function notify(type: string, entries: unknown[]) {
    const getEntries = vi.fn(() => entries as PerformanceEntry[]);

    observers.get(type)!.callback({ getEntries });

    return getEntries;
  }

  vi.stubGlobal('PerformanceObserver', Observer);
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', browser);
  vi.stubGlobal('performance', { now: () => 5000, interactionCount: 52 });
  const report = vi.fn();
  let allowed = true;
  const stop = observeWebVitals(report, () => allowed);

  notify('paint', [{ name: 'first-contentful-paint', startTime: 10, target: marker }]);
  notify('largest-contentful-paint', [
    { startTime: 25, url: marker },
    { startTime: 55, url: marker },
  ]);
  notify('layout-shift', [
    { startTime: 1000, value: 0.125 },
    { startTime: 1300, value: 0.25 },
    { startTime: 1400, value: 1, hadRecentInput: true },
    { startTime: 3000, value: 0.25 },
  ]);
  notify('event', [
    { interactionId: 7, duration: 96, target: marker },
    { interactionId: 7, duration: 60, target: marker },
    { interactionId: 14, duration: 40, target: marker },
  ]);
  notify('first-input', [{ interactionId: 21, duration: 32, target: marker }]);
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));

  expect(report.mock.calls).toEqual([
    ['fcp', 10],
    ['lcp', 55],
    ['cls', 0.375],
    ['inp', 40],
  ]);
  browser.dispatchEvent(new Event('pagehide'));
  expect(report).toHaveBeenCalledTimes(4);
  allowed = false;
  const late = notify('largest-contentful-paint', [{ startTime: 9000, url: marker }]);

  expect(late).not.toHaveBeenCalled();
  stop();
  for (const observer of observers.values()) {
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(observer.takeRecords).toHaveBeenCalledTimes(2);
  }
  document.dispatchEvent(new Event('visibilitychange'));
  browser.dispatchEvent(new Event('pagehide'));
  expect(report).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(report.mock.calls)).not.toContain(marker);
});
