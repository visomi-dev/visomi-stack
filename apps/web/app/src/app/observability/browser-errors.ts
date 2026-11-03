import { ErrorHandler, Service, inject, isDevMode } from '@angular/core';

import { BrowserTelemetry } from './browser-telemetry';

@Service({ autoProvided: false })
export class BrowserErrors implements ErrorHandler {
  private readonly telemetry = inject(BrowserTelemetry);

  handleError(error: unknown): void {
    if (isDevMode()) {
      console.error(error);
    }

    this.telemetry.report('unhandled_exception', error);
  }
}
