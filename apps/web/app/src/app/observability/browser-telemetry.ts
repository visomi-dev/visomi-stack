import { DestroyRef, InjectionToken, Service, inject } from '@angular/core';

import { type BrowserErrorCode, type createBrowserReporter } from '@visomi-stack/web-shared-observability';

// The browser entrypoint owns initialization; SSR never receives a reporter.
export const BROWSER_ERROR_REPORTER = new InjectionToken<ReturnType<typeof createBrowserReporter>>(
  'BrowserErrorReporter',
);

@Service({ autoProvided: false })
export class BrowserTelemetry {
  private readonly reporter = inject(BROWSER_ERROR_REPORTER, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  private readonly cleanup = this.destroyRef.onDestroy(() => this.reporter?.stop());

  report(code: BrowserErrorCode, error?: unknown, correlation?: string): void {
    void this.reporter?.report(code, error, undefined, correlation);
  }
}
