import { isPlatformBrowser } from '@angular/common';
import { ErrorHandler, Service, PLATFORM_ID, inject, isDevMode } from '@angular/core';

import { BrowserTelemetry } from './browser-telemetry';

@Service()
export class BrowserErrors implements ErrorHandler {
  private readonly telemetry = inject(BrowserTelemetry);

  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  handleError(error: unknown): void {
    if (!this.browser) {
      console.error('{"event":"app.render_failed"}');

      return;
    }

    if (isDevMode()) {
      console.error(error);
    }

    this.telemetry.report('unhandled_exception', error);
  }
}
