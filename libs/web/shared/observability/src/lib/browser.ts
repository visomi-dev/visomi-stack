import type { BrowserConsent } from './consent';
import type {
  BrowserApplication,
  BrowserErrorReport,
  BrowserLocation,
  BrowserTelemetryConfig,
  BrowserRouteMetric,
} from './contract';
import { browserScreen, describeBrowserError, type UnhandledErrorCode } from './error-description';
import { createPendingReports } from './pending-reports';
import { telemetryPost } from './transport';

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
  consent: BrowserConsent,
  options: { globalErrors?: boolean; documentPermit?: string | null } = {},
) {
  const transport = browser.fetch.bind(browser);
  let configuration: BrowserTelemetryConfig | undefined;
  let loading: Promise<void> | undefined;
  let refreshedAt = 0;
  let stopped = false;
  let windowStart = Date.now();
  let count = 0;
  const seen = new Set<string>();
  const captured = new WeakMap<object, Promise<void> | undefined>();
  const pending = createPendingReports();
  let sending = false;
  let performanceRuntime: ReturnType<(typeof import('./performance'))['createBrowserPerformance']> | undefined;
  let documentPermit = options.documentPermit === undefined ? consent.permit() : options.documentPermit;
  const performanceScreen = browserScreen(browser.location.pathname);
  const performanceAllowed = () => !stopped && !!documentPermit && consent.permit() === documentPermit;

  const unsubscribe = consent.subscribe(() => {
    if (!performanceAllowed()) {
      documentPermit = undefined;
      performanceRuntime?.stop();
      performanceRuntime = undefined;
    }

    pending.refresh();
  });

  // Document timings include buffered measurements, so they require a grant at document startup.
  const performanceReady = (async () => {
    if (!performanceAllowed()) {
      return false;
    }

    const config = await currentConfiguration();

    if (!config || !performanceAllowed()) {
      return false;
    }

    const { createBrowserPerformance } = await import('./performance');

    if (!performanceAllowed()) {
      return false;
    }

    performanceRuntime = createBrowserPerformance(
      application,
      performanceScreen,
      browser,
      currentConfiguration,
      performanceAllowed,
    );

    return true;
  })().catch(() => false);

  async function currentConfiguration(): Promise<BrowserTelemetryConfig | undefined> {
    if (!loading || Date.now() - refreshedAt >= 240000) {
      refreshedAt = Date.now();
      configuration = undefined;
      loading = loadConfiguration();
    }

    await loading;

    return configuration;
  }

  async function loadConfiguration(): Promise<void> {
    try {
      const response = await transport('/telemetry/config', {
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        mode: 'same-origin',
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      });

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
    } catch {
      // Configuration errors never produce further telemetry.
    }
  }

  async function send(report: BrowserErrorReport, allowed: () => boolean, automatic: boolean): Promise<boolean> {
    try {
      if (Date.now() - windowStart >= 60000) {
        windowStart = Date.now();
        count = 0;
        seen.clear();
      }

      if (stopped || !allowed() || count >= 5) {
        return false;
      }

      count++;
      const config = await currentConfiguration();

      if (stopped || !config || !allowed()) {
        return false;
      }

      const body = JSON.stringify(report);

      if (automatic && seen.has(body)) {
        return false;
      }

      if (automatic) {
        seen.add(body);
      }

      const response = await transport(browser.location.origin + '/telemetry/errors', {
        ...telemetryPost,
        headers: { 'content-type': 'application/json', 'x-browser-telemetry': config.token },
        body,
        signal: AbortSignal.timeout(3000),
      });

      return response.status === 202;
    } catch {
      // Telemetry failures never report themselves.
      return false;
    }
  }

  function report(
    code: UnhandledErrorCode,
    error?: unknown,
    source?: { filename: string; lineno: number; colno: number },
  ): Promise<void> | undefined {
    if (stopped) {
      return;
    }

    if (typeof error !== 'object' || error === null) {
      return capture(code, error, source);
    }

    if (!captured.has(error)) {
      captured.set(error, capture(code, error, source));
    }

    return captured.get(error);
  }

  function capture(
    code: UnhandledErrorCode,
    error: unknown,
    source: { filename: string; lineno: number; colno: number } | undefined,
  ): Promise<void> | undefined {
    const permit = consent.permit();
    const sanitized = describeBrowserError(application, browser.location.pathname, code, error);

    if (permit) {
      const location = configuration && browserLocation(error, browser.location.origin, configuration.assets, source);

      return sendCaptured(location ? { ...sanitized, location } : sanitized, permit);
    }

    pending.add(sanitized);

    return;
  }

  function sendCaptured(report: BrowserErrorReport, permit: string): Promise<void> {
    return send(report, () => consent.permit() === permit, true).then(() => undefined);
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
    consent,
    report,
    performanceReady,
    performanceAllowed,
    pending: pending.items,
    subscribePending: pending.subscribe,
    discard: pending.discard,
    sendCaptured,
    remember: pending.add,
    async sendPending(report: BrowserErrorReport): Promise<boolean> {
      const allowed = () => pending.has(report);

      if (sending || !allowed()) {
        return false;
      }

      sending = true;

      try {
        const accepted = await send(report, allowed, false);

        if (accepted) {
          pending.discard(report);
        }

        return accepted;
      } finally {
        sending = false;
      }
    },
    routeTransition(name: BrowserRouteMetric, duration: number): void {
      if (application === 'web-app' && performanceAllowed()) {
        performanceRuntime?.routeTransition(name, duration);
      }
    },
    stop(): void {
      stopped = true;
      unsubscribe();
      pending.clear();
      performanceRuntime?.stop();

      if (options.globalErrors !== false) {
        browser.removeEventListener('error', onError);
        browser.removeEventListener('unhandledrejection', onRejection);
      }
    },
  };
}
