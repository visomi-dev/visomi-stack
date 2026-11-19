import { ROOT_CONTEXT } from '@opentelemetry/api';
import { NavigationTimingInstrumentation } from '@opentelemetry/browser-instrumentation/experimental/navigation-timing';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { LoggerProvider } from '@opentelemetry/sdk-logs';

import { browserPerformanceMetrics } from './contract';
import type {
  BrowserApplication,
  BrowserScreen,
  BrowserTelemetryConfig,
  BrowserPerformanceReport,
  BrowserPerformanceMeasurement,
  BrowserRouteMetric,
} from './contract';
import { telemetryPost } from './transport';
import { observeWebVitals } from './web-vitals';

export function createBrowserPerformance(
  application: BrowserApplication,
  screen: BrowserScreen,
  browser: Window,
  configuration: () => Promise<BrowserTelemetryConfig | undefined>,
  allowed: () => boolean,
) {
  const transport = browser.fetch.bind(browser);
  let windowStart = Date.now();
  let count = 0;
  let stopped = false;
  const runtime = startBrowserPerformance((measurements) => void send(measurements), allowed);

  async function send(measurements: BrowserPerformanceMeasurement[]): Promise<void> {
    try {
      if (Date.now() - windowStart >= 60000) {
        windowStart = Date.now();
        count = 0;
      }

      if (stopped || !allowed() || count >= 12) {
        return;
      }

      count++;
      const config = await configuration();

      if (stopped || !allowed() || !config) {
        return;
      }

      const payload: BrowserPerformanceReport = { application, screen, measurements };

      await transport(browser.location.origin + '/telemetry/performance', {
        ...telemetryPost,
        headers: { 'content-type': 'application/json', 'x-browser-telemetry': config.token },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Performance delivery never reports its own failures or retries on unload.
    }
  }

  return {
    routeTransition: runtime.routeTransition,
    stop(): void {
      stopped = true;
      runtime.stop();
    },
  };
}

// Copy only approved numbers before any SDK record, queue or transport can retain source data.
export function performanceMeasurements(record: {
  eventName?: string;
  attributes?: Record<string, unknown>;
}): BrowserPerformanceMeasurement[] {
  const attributes = record.attributes ?? {};
  const values: [unknown, unknown][] =
    record.eventName === 'browser.web_vital'
      ? [[attributes['browser.web_vital.name'], attributes['browser.web_vital.value']]]
      : record.eventName === 'browser.route_transition'
        ? [[attributes['metric'], attributes['duration']]]
        : record.eventName === 'browser.navigation_timing'
          ? [
              ['dom_interactive', attributes['browser.navigation_timing.dom_interactive']],
              ['dom_content_loaded', attributes['browser.navigation_timing.dom_content_loaded_event_end']],
              ['load', attributes['browser.navigation_timing.load_event_end']],
              ['ttfb', attributes['browser.resource_timing.response_start']],
            ]
          : [];

  return values.flatMap(([name, value]) => {
    const approved = browserPerformanceMetrics.find((metric) => metric === name);

    return approved &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= (approved === 'cls' ? 10 : 300000)
      ? [{ name: approved, value: Number(value.toFixed(approved === 'cls' ? 4 : 2)) }]
      : [];
  });
}

export function startBrowserPerformance(
  send: (measurements: BrowserPerformanceMeasurement[]) => void,
  allowed: () => boolean,
) {
  let stopped = false;
  const capturing = () => !stopped && allowed();
  const provider = new LoggerProvider({
    resource: resourceFromAttributes({}),
    processors: [
      {
        onEmit(record) {
          if (capturing()) {
            send(
              browserPerformanceMetrics.flatMap((name) =>
                typeof record.attributes[name] === 'number' ? [{ name, value: record.attributes[name] as number }] : [],
              ),
            );
          }
        },
        forceFlush: async () => undefined,
        shutdown: async () => undefined,
      },
    ],
  });
  const logger = provider.getLogger('visomi-stack.browser-performance');
  const filteredProvider: Parameters<NavigationTimingInstrumentation['setLoggerProvider']>[0] = {
    getLogger: () => ({
      enabled: capturing,
      emit(record) {
        if (!capturing()) {
          return;
        }

        const measurements = performanceMeasurements(record);

        if (measurements.length > 0) {
          logger.emit({
            eventName: 'frontend.performance',
            context: ROOT_CONTEXT,
            attributes: Object.fromEntries(measurements.map(({ name, value }) => [name, value])),
          });
        }
      },
    }),
  };
  // The pinned 0.9 navigation instrument must be wired before enable().
  const navigation = new NavigationTimingInstrumentation({ enabled: false });
  let stopVitals: (() => void) | undefined;
  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    stopVitals?.();

    try {
      navigation.disable();
    } catch {
      // The provider must shut down even if an instrument fails to disable.
    }
    void provider.shutdown().catch(() => undefined);
  };

  try {
    navigation.setLoggerProvider(filteredProvider);
    navigation.enable();
    const vitalLogger = filteredProvider.getLogger('visomi-stack.browser-vitals');

    stopVitals = observeWebVitals(
      (name, value) =>
        vitalLogger.emit({
          eventName: 'browser.web_vital',
          attributes: { 'browser.web_vital.name': name, 'browser.web_vital.value': value },
        }),
      capturing,
    );
  } catch {
    stop();
  }

  return {
    stop,
    routeTransition(name: BrowserRouteMetric, duration: number): void {
      // Router events, URLs and navigation IDs never enter the SDK.
      filteredProvider.getLogger('visomi-stack.browser-routes').emit({
        eventName: 'browser.route_transition',
        attributes: { metric: name, duration },
      });
    },
  };
}
