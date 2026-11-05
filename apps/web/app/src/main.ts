import { bootstrapApplication } from '@angular/platform-browser';
import { isDevMode } from '@angular/core';

import { config } from './app/app.config.browser';
import { App } from './app/app';
import { BROWSER_ERROR_REPORTER } from './app/observability/browser-telemetry';

import { createBrowserReporter } from '@visomi-stack/web-shared-observability';

const reporter = createBrowserReporter('web-app', window, { globalErrors: false });

bootstrapApplication(App, {
  ...config,
  providers: [...config.providers, { provide: BROWSER_ERROR_REPORTER, useValue: reporter }],
}).catch((error: unknown) => {
  if (isDevMode()) {
    console.error(error);
  }

  void reporter.report('startup_failed', error).finally(() => reporter.stop());
});
