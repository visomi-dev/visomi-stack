import { isPlatformBrowser, DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, ErrorHandler, Service, PLATFORM_ID, inject } from '@angular/core';

import { createBrowserReporter } from '@visomi-stack/web-shared-observability';

@Service()
export class BrowserErrors implements ErrorHandler {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID)) ? this.document.defaultView : null;
  private readonly reporter =
    this.browser && typeof this.browser.fetch === 'function'
      ? createBrowserReporter('web-app', this.browser)
      : undefined;

  constructor() {
    this.destroyRef.onDestroy(() => this.reporter?.stop());
  }

  handleError(error: unknown): void {
    if (!this.browser) {
      console.error('{"event":"app.render_failed"}');

      return;
    }

    void this.reporter?.report('unhandled_exception', error);
  }

  requestFailed(url: string, error: unknown): void {
    if (!this.browser || !(error instanceof HttpErrorResponse) || (error.status !== 0 && error.status < 500)) {
      return;
    }

    let endpoint: URL;

    try {
      endpoint = new URL(url, this.browser.location.origin);
    } catch {
      return;
    }

    if (endpoint.origin === this.browser.location.origin && endpoint.pathname.startsWith('/api/')) {
      void this.reporter?.report(
        'request_failed',
        undefined,
        undefined,
        error.headers.get('x-telemetry-context') ?? undefined,
      );
    }
  }
}
