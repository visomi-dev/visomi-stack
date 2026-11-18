import type { BrowserConsent } from './consent';
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
  if (/^(?:\/app)?\/(?:en|es)\/?$/.test(path) || /^\/app\/(?:en|es)\/foundations\/?$/.test(path)) {
    return 'home';
  }

  if (/^\/app\/(?:en|es)\/home\/?$/.test(path)) {
    return 'dashboard';
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

const pendingLimit = 5;
const pendingLifetime = 300000;

export function createBrowserReporter(
  application: BrowserApplication,
  browser: Window,
  consent: BrowserConsent,
  options: { globalErrors?: boolean } = {},
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
  const pending: { report: BrowserErrorReport; expires: number }[] = [];
  const listeners = new Set<() => void>();
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let sending = false;
  let performanceRuntime: ReturnType<(typeof import('./performance'))['createBrowserPerformance']> | undefined;
  let documentPermit = consent.permit();
  const performanceScreen = browserScreen(browser.location.pathname);
  const performanceAllowed = () => !stopped && !!documentPermit && consent.permit() === documentPermit;

  const unsubscribe = consent.subscribe(() => {
    if (!performanceAllowed()) {
      documentPermit = undefined;
      performanceRuntime?.stop();
      performanceRuntime = undefined;
    }

    notify();
  });

  // Document timings include buffered measurements, so they require a grant at document startup.
  const performanceReady = (async () => {
    if (!performanceAllowed()) {
      return false;
    }

    const config = await currentConfiguration();

    if (config?.performance !== true || !performanceAllowed()) {
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

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function expire(): void {
    clearTimeout(expiry);

    const originalSize = pending.length;

    while (pending[0]?.expires <= Date.now()) {
      pending.shift();
    }

    if (pending[0]) {
      expiry = setTimeout(expire, Math.max(1, pending[0].expires - Date.now()));
    }

    if (originalSize !== pending.length) {
      notify();
    }
  }

  function discard(report: BrowserErrorReport): void {
    const index = pending.findIndex((item) => item.report === report);

    if (index !== -1) {
      pending.splice(index, 1);
      expire();
      notify();
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

      const response = await transport('/telemetry/errors', {
        method: 'POST',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        keepalive: true,
        mode: 'same-origin',
        redirect: 'error',
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
    code: Exclude<BrowserErrorCode, 'request_failed'>,
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
    code: Exclude<BrowserErrorCode, 'request_failed'>,
    error: unknown,
    source: { filename: string; lineno: number; colno: number } | undefined,
  ): Promise<void> | undefined {
    const permit = consent.permit();
    const sanitized: BrowserErrorReport = {
      application,
      code,
      kind: browserErrorKind(error),
      screen: browserScreen(browser.location.pathname),
    };

    if (permit) {
      const location = configuration && browserLocation(error, browser.location.origin, configuration.assets, source);

      return send(location ? { ...sanitized, location } : sanitized, () => consent.permit() === permit, true).then(
        () => undefined,
      );
    }

    expire();

    if (
      pending.some(
        ({ report }) =>
          report.code === sanitized.code && report.kind === sanitized.kind && report.screen === sanitized.screen,
      )
    ) {
      return;
    }

    if (pending.length === pendingLimit) {
      pending.shift();
    }

    pending.push({ report: Object.freeze(sanitized), expires: Date.now() + pendingLifetime });
    expire();
    notify();

    return;
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
    pending: () => pending.map(({ report }) => report),
    subscribePending(listener: () => void): () => void {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    discard,
    async sendPending(report: BrowserErrorReport): Promise<boolean> {
      expire();
      const allowed = () => pending.some((item) => item.report === report && item.expires > Date.now());

      if (sending || !allowed()) {
        return false;
      }

      sending = true;

      try {
        const accepted = await send(report, allowed, false);

        if (accepted) {
          discard(report);
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
      pending.length = 0;
      clearTimeout(expiry);
      listeners.clear();
      performanceRuntime?.stop();

      if (options.globalErrors !== false) {
        browser.removeEventListener('error', onError);
        browser.removeEventListener('unhandledrejection', onRejection);
      }
    },
  };
}
