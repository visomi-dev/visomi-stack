import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  type ApplicationConfig,
  ErrorHandler,
  inject,
  provideBrowserGlobalErrorListeners,
  provideEnvironmentInitializer,
} from '@angular/core';
import { provideClientHydration, withI18nSupport } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { appRoutes } from './app.routes';
import { BrowserErrors } from './observability/browser-errors';
import { browserErrorsInterceptor } from './observability/browser-errors-interceptor';
import { BrowserRoutePerformance } from './observability/browser-route-performance';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withI18nSupport()),
    { provide: ErrorHandler, useExisting: BrowserErrors },
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([browserErrorsInterceptor])),
    provideRouter(appRoutes),
    provideEnvironmentInitializer(() => {
      inject(BrowserRoutePerformance);
    }),
  ],
};
