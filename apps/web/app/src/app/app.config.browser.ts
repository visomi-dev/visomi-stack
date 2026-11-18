import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ErrorHandler,
  inject,
  mergeApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideEnvironmentInitializer,
  type ApplicationConfig,
} from '@angular/core';

import { appConfig } from './app.config';
import { authInterceptor } from './auth/session/interceptor';
import { BrowserRealtimeSession } from './auth/session/browser-realtime-session';
import { BrowserSession } from './auth/session/browser-session';
import { Session } from './auth/session/session';
import { BrowserErrors } from './observability/browser-errors';
import { BrowserRoutePerformance } from './observability/browser-route-performance';
import { BrowserTelemetry } from './observability/browser-telemetry';

const browserConfig: ApplicationConfig = {
  providers: [
    BrowserSession,
    { provide: Session, useExisting: BrowserSession },
    BrowserRealtimeSession,
    BrowserErrors,
    { provide: ErrorHandler, useExisting: BrowserErrors },
    BrowserTelemetry,
    BrowserRoutePerformance,
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideEnvironmentInitializer(() => {
      inject(BrowserTelemetry);
      inject(BrowserRoutePerformance);
    }),
  ],
};

export const config = mergeApplicationConfig(appConfig, browserConfig);
