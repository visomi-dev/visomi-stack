import { bootstrapApplication } from '@angular/platform-browser';

import { appConfig } from './app/app.config';
import { App } from './app/app';

import { createBrowserReporter } from '@visomi-stack/web-shared-observability';

bootstrapApplication(App, appConfig).catch((error: unknown) => {
  const reporter = createBrowserReporter('web-app', window);

  void reporter.report('startup_failed', error).finally(() => reporter.stop());
});
