import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { DestroyRef, InjectionToken, Service, inject } from '@angular/core';

import {
  appVisitPage,
  type BrowserErrorCode,
  type createBrowserReporter,
} from '@visomi-stack/web-shared-observability';
import { trackVisits } from '@visomi-stack/web-shared-observability/visits';

// The browser entrypoint owns initialization; SSR never receives a reporter.
export const BROWSER_ERROR_REPORTER = new InjectionToken<ReturnType<typeof createBrowserReporter>>(
  'BrowserErrorReporter',
);

@Service({ autoProvided: false })
export class BrowserTelemetry {
  private readonly reporter = inject(BROWSER_ERROR_REPORTER, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly browser = inject(DOCUMENT).defaultView;

  private readonly router = this.reporter && inject(Router);

  private visits?: ReturnType<typeof trackVisits>;

  private readonly navigation = this.router?.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
    if (!(event instanceof NavigationEnd) || !this.browser || !this.reporter) {
      return;
    }

    if (this.visits) {
      this.visits.update();
    } else {
      this.visits = trackVisits(this.browser, this.reporter.consent, appVisitPage);
    }
  });
  private readonly cleanup = this.destroyRef.onDestroy(() => {
    this.visits?.stop();
    this.reporter?.stop();
    this.reporter?.consent.stop();
  });

  report(code: Exclude<BrowserErrorCode, 'request_failed'>, error?: unknown): void {
    void this.reporter?.report(code, error);
  }
}
