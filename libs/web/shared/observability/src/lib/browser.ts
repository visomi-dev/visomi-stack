import { browserErrorKinds } from './contract';
import type {
  BrowserApplication,
  BrowserErrorCode,
  BrowserErrorKind,
  BrowserErrorReport,
  BrowserLocation,
  BrowserScreen,
  BrowserTelemetryConfig,
  BrowserRouteMetric,
} from './contract';

// Only known page names cross the boundary; paths and navigation history stay in the browser.
export function browserScreen(path: string): BrowserScreen {
  if (/^(?:\/app)?\/(?:en|es)\/?$/.test(path)) {
    return 'home';
  }

  return /^(?:\/app)?\/(?:en|es)\/ui\/?$/.test(path) ? 'ui' : 'unknown';
}

export function browserErrorKind(error: unknown): BrowserErrorKind {
  try {
    const name = error instanceof Error ? error.name : undefined;

    return browserErrorKinds.find((kind) => kind === name) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function browserLocation(
  error: unknown,
  origin: string,
  assets: BrowserTelemetryConfig['assets'],
  source?: { filename: string; lineno: number; colno: number },
): BrowserLocation | undefined {
  try {
    const candidates = source ? [`${source.filename}:${source.lineno}:${source.colno}`] : [];

    if (error instanceof Error && typeof error.stack === 'string') {
      candidates.push(...error.stack.slice(0, 8192).split('\n').slice(1, 9));
    }

    for (const candidate of candidates) {
      const match = candidate.match(/(https?:\/\/[^\s()]+):(\d+):(\d+)\)?$/);

      if (!match) {
        continue;
      }

      const url = new URL(match[1]);
      const asset = assets.find((entry) => entry.path === url.pathname);
      const line = Number(match[2]);
      const column = Number(match[3]);

      if (
        url.origin === origin &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password &&
        asset &&
        Number.isSafeInteger(line) &&
        Number.isSafeInteger(column) &&
        line > 0 &&
        column > 0
      ) {
        return { asset: asset.id, line, column };
      }
    }
  } catch {
    // Errors, including rejection values, may contain hostile getters. Reporting remains best effort.
  }

  return undefined;
}

export function createBrowserReporter(
  application: BrowserApplication,
  browser: Window,
  options: { globalErrors?: boolean } = {},
) {
  const transport = browser.fetch.bind(browser);
  let configuration: BrowserTelemetryConfig | undefined;
  let stopped = false;
  let windowStart = Date.now();
  let count = 0;
  const seen = new Set<string>();
  const errorReports = new WeakMap<object, Promise<void>>();
  let refreshedAt = Date.now();
  let ready = loadConfiguration();
  let performanceRuntime: ReturnType<(typeof import('./performance'))['createBrowserPerformance']> | undefined;
  const performanceScreen = browserScreen(browser.location.pathname);

  // Neither the SDK nor its observers are loaded when performance capture is disabled.
  const performanceReady = ready
    .then(async () => {
      if (stopped || configuration?.performance !== true) {
        return false;
      }

      const { createBrowserPerformance } = await import('./performance');

      if (!stopped) {
        performanceRuntime = createBrowserPerformance(application, performanceScreen, browser, currentConfiguration);

        return true;
      }

      return false;
    })
    .catch(() => false);

  async function currentConfiguration(): Promise<BrowserTelemetryConfig | undefined> {
    if (Date.now() - refreshedAt >= 240000) {
      ready = loadConfiguration();
    }

    await ready;

    return configuration;
  }

  function loadConfiguration(): Promise<void> {
    refreshedAt = Date.now();
    configuration = undefined;

    return Promise.resolve()
      .then(() =>
        transport('/telemetry/config', {
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          mode: 'same-origin',
          redirect: 'error',
          signal: AbortSignal.timeout(3000),
        }),
      )
      .then(async (response) => {
        if (!response.ok) {
          return;
        }

        const value = await response.json();

        if (
          typeof value?.token === 'string' &&
          value.token.length <= 1024 &&
          Array.isArray(value.assets) &&
          value.assets.length <= 512 &&
          value.assets.every(
            (asset: { path?: unknown; id?: unknown }) =>
              typeof asset?.path === 'string' &&
              asset.path.startsWith('/') &&
              typeof asset.id === 'string' &&
              /^[a-f0-9]{64}$/.test(asset.id),
          )
        ) {
          configuration = value;
        }
      })
      .catch(() => undefined);
  }

  function report(
    code: BrowserErrorCode,
    error?: unknown,
    source?: { filename: string; lineno: number; colno: number },
    correlation?: string,
  ): Promise<void> {
    if (typeof error !== 'object' || error === null) {
      return sendReport(code, error, source, correlation);
    }

    const existing = errorReports.get(error);

    if (existing) {
      return existing;
    }

    // Framework error handling and bootstrap rejection can observe the same failure.
    const pending = sendReport(code, error, source, correlation);

    errorReports.set(error, pending);

    return pending;
  }

  async function sendReport(
    code: BrowserErrorCode,
    error?: unknown,
    source?: { filename: string; lineno: number; colno: number },
    correlation?: string,
  ): Promise<void> {
    try {
      if (Date.now() - windowStart >= 60000) {
        windowStart = Date.now();
        count = 0;
        seen.clear();
      }

      if (stopped || count >= 5) {
        return;
      }

      count++;

      await currentConfiguration();

      if (stopped || !configuration) {
        return;
      }

      const location = browserLocation(error, browser.location.origin, configuration.assets, source);
      const payload: BrowserErrorReport = {
        application,
        code,
        kind: browserErrorKind(error),
        screen: browserScreen(browser.location.pathname),
        ...(location ? { location } : {}),
        ...(typeof correlation === 'string' && correlation.length <= 1024 ? { correlation } : {}),
      };
      const serialized = JSON.stringify(payload);

      if (seen.has(serialized)) {
        return;
      }

      seen.add(serialized);

      await transport('/telemetry/errors', {
        method: 'POST',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        keepalive: true,
        mode: 'same-origin',
        redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-browser-telemetry': configuration.token },
        body: serialized,
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Telemetry failures must not create unhandled rejections or report themselves recursively.
    }
  }

  function onError(event: ErrorEvent): void {
    void report('unhandled_exception', event.error, event);
  }

  function onRejection(event: PromiseRejectionEvent): void {
    void report('unhandled_rejection', event.reason);
  }

  if (options.globalErrors !== false) {
    browser.addEventListener('error', onError);
    browser.addEventListener('unhandledrejection', onRejection);
  }

  return {
    report,
    ready,
    performanceReady,
    routeTransition(name: BrowserRouteMetric, duration: number): void {
      if (!stopped && application === 'web-app') {
        performanceRuntime?.routeTransition(name, duration);
      }
    },
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = new URL(input instanceof Request ? input.url : String(input), browser.location.origin);
      const observed = url.origin === browser.location.origin && url.pathname.startsWith('/api/');

      try {
        const response = await transport(input, init);

        if (observed && response.status >= 500) {
          void report('request_failed', undefined, undefined, response.headers.get('x-telemetry-context') ?? undefined);
        }

        return response;
      } catch (error) {
        if (observed) {
          void report('request_failed');
        }

        throw error;
      }
    },
    stop(): void {
      stopped = true;
      performanceRuntime?.stop();

      if (options.globalErrors !== false) {
        browser.removeEventListener('error', onError);
        browser.removeEventListener('unhandledrejection', onRejection);
      }
    },
  };
}
